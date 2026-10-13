package app.relay.nativeclient

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.security.MessageDigest

/** No transcript, objective or credentials. Android-independent transition policy. */
class NotificationLedger(val scope: String, val generation: String = UUID.randomUUID().toString()) {
    data class Watch(val id: String, val token: String, val expires: Long, var key: String = "", var terminal: Boolean = false)
    data class Change(val token: String, val kind: String)
    val watches = mutableListOf<Watch>()

    fun watch(detail: JSONObject, now: Long): Boolean {
        val task = detail.optJSONObject("task") ?: return false
        val id = task.optString("id")
        watches.removeAll { it.expires <= now }
        if (!safeId(id) || task.optString("status") in TERMINAL || watches.any { it.id == id }) return false
        while (watches.size >= 20) watches.removeAt(0)
        watches.add(Watch(id, UUID.randomUUID().toString(), now + TTL))
        return true
    }
    fun observe(detail: JSONObject, now: Long): Change? {
        val task = detail.optJSONObject("task") ?: return null
        val watch = watches.firstOrNull { it.id == task.optString("id") && it.expires > now } ?: return null
        if (watch.terminal) return null
        val status = task.optString("status")
        watch.terminal = status in TERMINAL
        val approvals = detail.optJSONArray("approvals") ?: JSONArray()
        val pending = (0 until approvals.length()).mapNotNull { approvals.optJSONObject(it) }
            .filter { it.optString("status") == "pending" }.map { it.optString("id") }.filter(::safeId).sorted().take(20)
        val key = when {
            status == "completed" || status == "failed" -> status
            status !in TERMINAL && status != "paused" && pending.isNotEmpty() -> "approval:" + MessageDigest.getInstance("SHA-256")
                .digest(pending.joinToString(",").toByteArray()).joinToString("") { "%02x".format(it) }
            else -> ""
        }
        if (watch.key == key) return null
        watch.key = key
        return Change(watch.token, if (key.startsWith("approval:")) "approval" else key.ifEmpty { "clear" })
    }
    fun activeIds(now: Long) = watches.filter { it.expires > now && !it.terminal }.map { it.id }
    fun resolve(token: String, now: Long) = watches.firstOrNull { it.token == token && it.expires > now }?.id
    fun encode(): String = JSONObject().put("scope", scope).put("generation", generation).put("watches", JSONArray().also { array ->
        watches.forEach { array.put(JSONObject().put("id", it.id).put("token", it.token).put("expires", it.expires).put("key", it.key).put("terminal", it.terminal)) }
    }).toString()

    companion object {
        const val TTL = 7 * 24 * 60 * 60 * 1000L
        private val TERMINAL = setOf("completed", "failed", "cancelled")
        fun safeId(value: String) = Regex("^[A-Za-z0-9_-]{1,160}$").matches(value)
        fun decode(value: String, scope: String): NotificationLedger? = runCatching {
            require(value.length <= 64_000)
            val json = JSONObject(value)
            require(json.getString("scope") == scope)
            val result = NotificationLedger(scope, json.getString("generation"))
            val array = json.getJSONArray("watches"); require(array.length() <= 20)
            repeat(array.length()) {
                val item = array.getJSONObject(it)
                val id = item.getString("id"); require(safeId(id))
                val token = item.getString("token"); UUID.fromString(token)
                val key = item.getString("key"); require(key.length <= 3300)
                result.watches.add(Watch(id, token, item.getLong("expires"), key, item.optBoolean("terminal")))
            }
            result
        }.getOrNull()
    }
}
