package app.relay.nativeclient

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/** One shared gate covers request admission through publication, not only storage writes. */
internal class SerializedTaskReads {
    private val mutex = Mutex()
    suspend fun <T> read(fetch: suspend () -> T, publish: (T) -> Unit): T = mutex.withLock {
        fetch().also(publish)
    }
}

/** Authenticated, bounded read loop. Callbacks must also serialize publication with invalidation. */
internal suspend fun runNotificationMonitor(
    expectedAccount: String,
    ids: List<String>,
    current: () -> Boolean,
    authenticate: suspend () -> String,
    read: suspend (String) -> JSONObject,
    observed: (JSONObject) -> Unit,
    forget: (String) -> Unit,
    revoke: () -> Unit
) {
    try {
        if (!current()) return
        val account = authenticate()
        if (!current()) return
        if (account != expectedAccount) { revoke(); return }
        for (id in ids.take(20).filter(NotificationLedger::safeId)) {
            if (!current()) return
            try {
                val detail = read(id)
                if (!current()) return
                observed(detail)
            } catch (error: RelayError) {
                if (!current()) return
                if (error.status in listOf(403, 404)) forget(id) else throw error
            }
        }
    } catch (error: CancellationException) { throw error }
    catch (error: Exception) {
        if (error is RelayError && error.status == 401 && current()) revoke()
        // Ordinary connection failures are quiet and leave the next periodic run to retry.
    }
}
