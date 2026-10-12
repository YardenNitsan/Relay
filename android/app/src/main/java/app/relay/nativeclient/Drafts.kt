package app.relay.nativeclient

import javax.crypto.SecretKey
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import java.security.MessageDigest
import org.json.JSONObject

data class DraftRecord(val text: String = "", val workspaceId: String? = null, val assistantId: String? = null,
    val modelId: String? = null, val uncertain: Boolean = false)
interface DraftStorage {
    fun read(key: String): ByteArray?
    fun write(key: String, bytes: ByteArray)
    fun remove(key: String)
    fun clear()
}
class DraftRepository(private val storage: DraftStorage, private val key: () -> SecretKey) {
    private var generation = 0L
    private var scope: Pair<String, String>? = null
    private val revisions = mutableMapOf<String, Long>()
    @Synchronized fun activate(origin: String, user: String): Long {
        require(user.isNotBlank() && user.length <= 200)
        scope = Protocol.origin(origin) to user
        revisions.clear()
        return ++generation
    }
    private fun identity(conversation: String): String {
        require(conversation.isNotBlank() && conversation.length <= 200)
        val (origin, user) = requireNotNull(scope)
        return listOf("relay-draft-v1", origin, user, conversation).joinToString("") { "${it.length}:$it" }
    }
    private fun storageKey(identity: String) = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    @Synchronized fun save(epoch: Long, conversation: String, revision: Long, record: DraftRecord): Boolean {
        if (scope == null || epoch != generation || revision <= (revisions[conversation] ?: -1)) return false
        require(record.text.length <= 32000)
        require(listOf(record.workspaceId, record.assistantId, record.modelId).all { it == null || it.length <= 200 })
        val identity = identity(conversation)
        if (record.text.isBlank() && !record.uncertain) {
            storage.remove(storageKey(identity))
            revisions[conversation] = revision
            return true
        }
        val payload = JSONObject().put("text", record.text).put("workspace", record.workspaceId)
            .put("assistant", record.assistantId).put("model", record.modelId).put("uncertain", record.uncertain).toString()
        storage.write(storageKey(identity), SessionEnvelope.encrypt(key(), identity, payload))
        revisions[conversation] = revision
        return true
    }
    @Synchronized fun load(epoch: Long, conversation: String): DraftRecord {
        if (scope == null || epoch != generation) return DraftRecord()
        return try {
            val identity = identity(conversation)
            val bytes = storage.read(storageKey(identity)) ?: return DraftRecord()
            require(bytes.size in 29..262144)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(identity.toByteArray(Charsets.UTF_8))
            val data = JSONObject(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
            val text = data.getString("text"); require(text.length <= 32000)
            fun value(name: String) = data.optString(name).takeUnless { it.isBlank() || it == "null" }?.also { require(it.length <= 200) }
            DraftRecord(text, value("workspace"), value("assistant"), value("model"), data.optBoolean("uncertain"))
        } catch (_: Exception) { DraftRecord() }
    }
    @Synchronized fun clear() { generation++; scope = null; revisions.clear(); storage.clear() }
}
fun acknowledgedDraft(current: DraftRecord, submitted: String): DraftRecord =
    current.copy(text = if (current.text.trim() == submitted.trim()) "" else current.text, uncertain = false)
