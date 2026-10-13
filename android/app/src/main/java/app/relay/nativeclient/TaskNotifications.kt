package app.relay.nativeclient

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** All ledger publication/invalidation is serialized, including late worker responses. */
class TaskNotifications(context: Context) {
    private val context = context.applicationContext
    private val prefs = context.getSharedPreferences("relay_task_notifications", Context.MODE_PRIVATE)
    private val vault = SessionVault(context)
    private val manager = context.getSystemService(NotificationManager::class.java)
    data class Binding(val origin: String, val account: String, val fingerprint: String) {
        val scope: String get() = "$origin\n$account\n$fingerprint"
    }
    data class Snapshot(val binding: Binding, val generation: String, val ids: List<String>)

    fun binding(origin: String, account: String, cookie: String) = Binding(origin, account, fingerprint(cookie))
    private fun read(binding: Binding): NotificationLedger? { return try {
        val encrypted = prefs.getString("ledger", null) ?: return null
        val saved = vault.load() ?: return null
        if (saved.first != binding.origin || fingerprint(saved.second) != binding.fingerprint) return null
        NotificationLedger.decode(vault.unprotectNotifications(encrypted), binding.scope)
    } catch (_: Exception) { null } }
    private fun write(binding: Binding, ledger: NotificationLedger) {
        check(ledger.scope == binding.scope)
        check(prefs.edit().putString("ledger", vault.protectNotifications(ledger.encode())).commit())
    }
    fun enabled(binding: Binding): Boolean = synchronized(LOCK) { read(binding) != null }
    fun allowed(): Boolean = manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    fun activate(binding: Binding) = synchronized(LOCK) {
        // A restored session keeps opt-in; a replacement account/session never inherits it.
        if (read(binding) == null) clearLocked()
        else schedule()
    }
    fun enable(binding: Binding): Boolean = synchronized(LOCK) {
        if (!allowed()) return false
        val saved = vault.load() ?: return false
        if (saved.first != binding.origin || fingerprint(saved.second) != binding.fingerprint) return false
        clearLocked()
        write(binding, NotificationLedger(binding.scope))
        schedule()
        true
    }
    private fun schedule() {
        val work = PeriodicWorkRequestBuilder<TaskNotificationWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, work)
    }
    private fun clearLocked() {
        prefs.edit().clear().commit()
        manager.cancelAll()
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
    }
    fun clear() = synchronized(LOCK) { clearLocked() }
    fun invalidate(snapshot: Snapshot) = synchronized(LOCK) {
        if (read(snapshot.binding)?.generation == snapshot.generation) clearLocked()
    }
    fun snapshot(): Snapshot? = synchronized(LOCK) {
        val parts = runCatching {
            JSONObject(vault.unprotectNotifications(prefs.getString("ledger", null) ?: return null)).getString("scope").split('\n')
        }.getOrNull() ?: return null
        if (parts.size != 3) return null
        val binding = Binding(parts[0], parts[1], parts[2])
        val ledger = read(binding) ?: return null
        val expired = ledger.watches.filter { it.expires <= System.currentTimeMillis() }
        if (expired.isNotEmpty()) {
            expired.forEach { manager.cancel(it.token, 0) }
            ledger.watches.removeAll(expired.toSet()); write(binding, ledger)
        }
        Snapshot(binding, ledger.generation, ledger.activeIds(System.currentTimeMillis()))
    }
    fun current(snapshot: Snapshot) = synchronized(LOCK) { read(snapshot.binding)?.generation == snapshot.generation }
    suspend fun readTask(client: RelayClient, id: String, binding: Binding?, watch: Boolean = false, expected: Snapshot? = null): JSONObject {
        require(NotificationLedger.safeId(id))
        var admitted: Snapshot? = null
        return TASK_READS.read({
            admitted = snapshot()?.takeIf { it.binding == binding && (expected == null || it.generation == expected.generation) }
            client.json("/api/tasks/$id") as JSONObject
        }, { detail ->
            synchronized(LOCK) {
                val snapshot = admitted
                if (snapshot != null && current(snapshot)) {
                    if (watch) watch(snapshot.binding, detail)
                    observe(snapshot, detail)
                }
            }
        })
    }
    fun watch(binding: Binding, detail: JSONObject): Unit = synchronized(LOCK) {
        val ledger = read(binding) ?: return
        val before = ledger.watches.map { it.token }
        if (ledger.watch(detail, System.currentTimeMillis())) {
            write(binding, ledger)
            (before - ledger.watches.map { it.token }.toSet()).forEach { manager.cancel(it, 0) }
        }
    }
    fun observe(snapshot: Snapshot, detail: JSONObject): Unit = synchronized(LOCK) {
        val ledger = read(snapshot.binding) ?: return
        if (ledger.generation != snapshot.generation || !allowed()) return
        val change = ledger.observe(detail, System.currentTimeMillis())
        write(snapshot.binding, ledger)
        if (change == null) return
        if (change.kind == "clear") { manager.cancel(change.token, 0); return }
        val channel = NotificationChannel(CHANNEL, "Private task updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Generic completion, failure and approval updates for watched tasks"
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        manager.createNotificationChannel(channel)
        val intent = Intent(context, MainActivity::class.java).setAction(TAP_PREFIX + change.token)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val title = when (change.kind) { "completed" -> "Task completed"; "failed" -> "Task failed"; else -> "Task needs approval" }
        val notification = Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_task_notification)
            .setContentTitle(title).setContentText("Open Relay to inspect this task securely.")
            .setVisibility(Notification.VISIBILITY_SECRET).setContentIntent(pending).setAutoCancel(true)
            .setTimeoutAfter((ledger.watches.first { it.token == change.token }.expires - System.currentTimeMillis()).coerceAtLeast(1)).build()
        try { manager.notify(change.token, 0, notification) } catch (_: SecurityException) { /* OS permission can change between check and post. */ }
    }
    fun resolve(binding: Binding, token: String): String? = synchronized(LOCK) {
        read(binding)?.resolve(token, System.currentTimeMillis())
    }
    fun dismiss(token: String) { manager.cancel(token, 0) }
    fun forget(snapshot: Snapshot, id: String): Unit = synchronized(LOCK) {
        val ledger = read(snapshot.binding) ?: return
        if (ledger.generation != snapshot.generation) return
        ledger.watches.filter { it.id == id }.forEach { manager.cancel(it.token, 0) }
        ledger.watches.removeAll { it.id == id }; write(snapshot.binding, ledger)
    }
    companion object {
        private val LOCK = Any()
        private val TASK_READS = SerializedTaskReads()
        private const val WORK = "relay-private-task-monitor"
        private const val CHANNEL = "relay-private-tasks-v1"
        const val TAP_PREFIX = "app.relay.nativeclient.TASK."
        fun fingerprint(cookie: String) = MessageDigest.getInstance("SHA-256").digest(cookie.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

class TaskNotificationWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val notifications = TaskNotifications(applicationContext)
        val snapshot = notifications.snapshot() ?: return@withContext Result.success()
        // Revalidate even after all tasks settle: revocation must clear delivered notifications too.
        if (!notifications.allowed()) return@withContext Result.success()
        val saved = SessionVault(applicationContext).load() ?: return@withContext Result.success()
        if (saved.first != snapshot.binding.origin || TaskNotifications.fingerprint(saved.second) != snapshot.binding.fingerprint) return@withContext Result.success()
        val client = RelayClient(saved.first, saved.second)
        try {
            withTimeoutOrNull(120_000) {
                runNotificationMonitor(snapshot.binding.account, snapshot.ids, { notifications.current(snapshot) },
                    { client.session().getJSONObject("user").getString("id") },
                    { id -> notifications.readTask(client, id, snapshot.binding, expected = snapshot) },
                    {}, { notifications.forget(snapshot, it) },
                    { notifications.invalidate(snapshot) })
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (error is RelayError && error.status == 401) notifications.invalidate(snapshot)
            // A transient network/TLS/server failure leaves the next periodic check to retry quietly.
        } finally { client.close() }
        Result.success()
    }
}
