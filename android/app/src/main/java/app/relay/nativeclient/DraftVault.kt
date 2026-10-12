package app.relay.nativeclient

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Draft payloads and context are encrypted; preference keys disclose no host/account IDs. */
class DraftVault(context: Context) {
    private val prefs = context.getSharedPreferences("relay_drafts", Context.MODE_PRIVATE)
    private val alias = "relay_drafts_v1"
    val repository = DraftRepository(object : DraftStorage {
        override fun read(key: String): ByteArray? = prefs.getString(key, null)?.let { Base64.decode(it, Base64.NO_WRAP) }
        override fun write(key: String, bytes: ByteArray) {
            check(prefs.contains(key) || prefs.all.size < 100) { "Local draft storage is full." }
            check(prefs.edit().putString(key, Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) { "Draft storage failed." }
        }
        override fun remove(key: String) {
            check(prefs.edit().remove(key).commit()) { "Draft deletion failed." }
        }
        override fun clear() {
            try { check(prefs.edit().clear().commit()) { "Draft deletion failed." } }
            finally { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias) }
        }
    }, ::key)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
}
