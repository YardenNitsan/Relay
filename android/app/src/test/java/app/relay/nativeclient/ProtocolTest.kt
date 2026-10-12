package app.relay.nativeclient

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class ProtocolTest {
    @Test fun acceptsOnlyExactHttpsOrigins() {
        assertEquals("https://192.168.1.8:4319", Protocol.origin("https://192.168.1.8:4319/"))
        assertEquals("https://relay.example.com", Protocol.origin("https://relay.example.com"))
        listOf("http://192.168.1.8", "https://user:secret@relay.example.com", "https://host/path", "https://host?token=x", "https://host#x", "https://localhost", "https://127.0.0.1", "https://host\\evil", "https://host:0", "https://host:70000").forEach {
            assertThrows(IllegalArgumentException::class.java) { Protocol.origin(it) }
        }
    }
    @Test fun errorsNeverReflectServerHtmlOrSecrets() {
        assertTrue(Protocol.safeError(302, "<html>cookie=SECRET</html>").contains("Cloudflare"))
        assertFalse(Protocol.safeError(500, "{\"error\":\"SECRET\"}").contains("SECRET"))
        assertTrue(Protocol.safeError(401, "{\"code\":\"LAN_INVITATION_INVALID\"}").contains("invitation"))
        assertTrue(Protocol.safeError(403, "{\"code\":\"CSRF\"}").contains("session"))
    }
    @Test fun storageAuthenticatesHostAndCiphertext() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val encrypted = SessionEnvelope.encrypt(key, "https://host", "secret cookie")
        assertFalse(String(encrypted).contains("secret cookie"))
        assertEquals("secret cookie", SessionEnvelope.decrypt(key, "https://host", encrypted))
        assertThrows(Exception::class.java) { SessionEnvelope.decrypt(key, "https://other", encrypted) }
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { SessionEnvelope.decrypt(key, "https://host", encrypted) }
        assertThrows(Exception::class.java) { SessionEnvelope.decrypt(key, "https://host", byteArrayOf(1)) }
    }
    @Test fun encryptionUsesFreshNonceAndRejectsWrongKey() {
        val keys = KeyGenerator.getInstance("AES").apply { init(256) }
        val key = keys.generateKey()
        val first = SessionEnvelope.encrypt(key, "https://host", "cookie")
        val second = SessionEnvelope.encrypt(key, "https://host", "cookie")
        assertFalse(first.contentEquals(second))
        assertThrows(Exception::class.java) { SessionEnvelope.decrypt(keys.generateKey(), "https://host", first) }
    }
    @Test fun originNormalizesDefaultPortAndPreservesLanDns() {
        assertEquals("https://relay.example.com", Protocol.origin(" https://relay.example.com:443/ "))
        assertEquals("https://[fd12::40]:4319", Protocol.origin("https://[fd12::40]:4319"))
        assertEquals("https://relay.team.workers.dev", Protocol.origin("https://relay.team.workers.dev"))
        // Authentication is rejected by transport redirects / connection:lan,
        // not by guessing deployment type from a hostname string.
    }
}
