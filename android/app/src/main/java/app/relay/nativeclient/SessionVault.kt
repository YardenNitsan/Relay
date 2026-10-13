package app.relay.nativeclient

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Only encrypted cookie material is persisted. No invitation, CSRF or transcript. */
class SessionVault(context: Context) {
    private val prefs = context.getSharedPreferences("relay_session", Context.MODE_PRIVATE)
    private val alias = "relay_session_v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    fun save(origin: String, cookie: String) {
        val bytes = SessionEnvelope.encrypt(key(), origin, cookie)
        check(prefs.edit().putString("origin", origin).putString("cookie", Base64.encodeToString(bytes, Base64.NO_WRAP)).commit()) { "The device could not securely save this session." }
    }
    fun load(): Pair<String, String>? = try {
        val origin = prefs.getString("origin", null)
        val encoded = prefs.getString("cookie", null)
        if (origin == null || encoded == null) null else Protocol.origin(origin) to SessionEnvelope.decrypt(key(), origin, Base64.decode(encoded, Base64.NO_WRAP))
    } catch (_: Exception) { clear(); null }
    fun clear() { prefs.edit().clear().commit() }
    internal fun protectNotifications(value: String): String = Base64.encodeToString(
        SessionEnvelope.encrypt(key(), "relay-notification-ledger-v1", value), Base64.NO_WRAP)
    internal fun unprotectNotifications(value: String): String = SessionEnvelope.decrypt(
        key(), "relay-notification-ledger-v1", Base64.decode(value, Base64.NO_WRAP))
}
