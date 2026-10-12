package app.relay.nativeclient

import javax.crypto.SecretKey
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import java.net.URI
import org.json.JSONObject

object Protocol {
    fun origin(input: String): String {
        val raw = input.trim()
        require(raw.length in 1..253 && raw.none { it.isWhitespace() || it.code < 32 || it == '\\' }) { "Enter an exact HTTPS LAN origin." }
        val uri = try { URI(raw) } catch (_: Exception) { throw IllegalArgumentException("Enter an exact HTTPS LAN origin.") }
        val host = uri.host?.lowercase() ?: throw IllegalArgumentException("Enter a valid HTTPS hostname or private IP.")
        require(uri.scheme == "https" && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") && (uri.port == -1 || uri.port in 1..65535)) { "Use HTTPS without a path, password, query or fragment." }
        require(host != "localhost" && !host.endsWith(".localhost") && host != "127.0.0.1" && host != "[::1]" && host != "::1") { "Use the host's LAN address, not this phone's loopback address." }
        return "https://$host" + if (uri.port != -1 && uri.port != 443) ":${uri.port}" else ""
    }
    fun safeError(status: Int, body: String): String {
        val code = runCatching { JSONObject(body.take(16384)).optString("code") }.getOrDefault("")
        return when {
            status in 300..399 -> "Cloudflare Access and redirected login are not supported in this LAN preview. Use the configured LAN HTTPS origin."
            code == "LAN_INVITATION_INVALID" -> "This invitation expired, was used or was revoked. Ask the host owner for a new invitation."
            status == 401 -> "Your LAN session expired or was revoked. Connect with a new invitation."
            code == "CSRF" -> "The session could not authorize this action. Reconnect before retrying."
            status == 403 -> "Your account is not permitted to perform this action."
            status == 404 -> "This item is unavailable or is not shared with your account."
            status == 409 -> "The host state changed. Refresh and review before trying again."
            status == 429 -> "The host limit was reached. Wait before reconnecting or retrying."
            status == 413 -> "The request exceeds the host's size limit."
            else -> "The host could not complete this request (HTTP $status). Refresh to check the current state."
        }
    }
}
object SessionEnvelope {
    fun encrypt(key: SecretKey, origin: String, text: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
    }
    fun decrypt(key: SecretKey, origin: String, bytes: ByteArray): String {
        require(bytes.size in 29..32768)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
    }
}
