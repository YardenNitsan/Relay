package app.relay.nativeclient

import java.net.ConnectException
import javax.crypto.KeyGenerator
import org.junit.Assert.*
import org.junit.Test

class SessionRecoveryTest {
    private class ProtectedSession {
        val host = "https://10.100.102.13:4443"
        private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        var encrypted: ByteArray? = null
        var origin = host
        var clears = 0
        fun save(cookie: String) { encrypted = SessionEnvelope.encrypt(key, origin, cookie) }
        fun load() = encrypted?.let { origin to SessionEnvelope.decrypt(key, origin, it) }
        fun recovery() = SessionRecovery(::load) { encrypted = null; clears++ }
    }

    @Test fun `offline cold restore retains protected credential for revalidation only`() {
        val vault = ProtectedSession().apply { save("saved-cookie") }
        val before = vault.encrypted!!.clone()
        val recovery = vault.recovery()
        assertTrue(recovery.failed(vault.host, ConnectException("offline")))
        assertArrayEquals(before, vault.encrypted)
        assertEquals(vault.host to "saved-cookie", recovery.retry())
        assertEquals(0, vault.clears)
        recovery.verified()
        assertNull(recovery.retry())
        assertNotNull(vault.load())
    }

    @Test fun `redeemed invitation with saved cookie survives later list failure`() {
        val vault = ProtectedSession(); val recovery = vault.recovery()
        assertFalse(recovery.failed(vault.host, ConnectException("pairing not confirmed")))
        assertNull(recovery.retry())
        vault.save("cookie-issued-after-redemption")
        assertTrue(recovery.failed(vault.host, RelayError(503, "list unavailable")))
        assertEquals(vault.host to "cookie-issued-after-redemption", recovery.retry())
    }

    @Test fun `revoked session clears protected credential and retry admission`() {
        val vault = ProtectedSession().apply { save("revoked-cookie") }; val recovery = vault.recovery()
        recovery.failed(vault.host, ConnectException())
        assertFalse(recovery.failed(vault.host, RelayError(401, "revoked")))
        assertNull(vault.load()); assertNull(recovery.retry()); assertNull(recovery.origin)
    }

    @Test fun `forget removes protected credential and never retries`() {
        val vault = ProtectedSession().apply { save("saved-cookie") }; val recovery = vault.recovery()
        recovery.failed(vault.host, ConnectException())
        recovery.forget()
        assertNull(vault.load()); assertNull(recovery.retry()); assertNull(recovery.origin)
    }

    @Test fun `retry cannot move a credential to another host or use a replaced origin`() {
        val vault = ProtectedSession().apply { save("saved-cookie") }; val recovery = vault.recovery()
        assertFalse(recovery.failed("https://another.test", ConnectException()))
        assertNull(recovery.retry())
        assertTrue(recovery.failed(vault.host, ConnectException()))
        vault.origin = "https://another.test"; vault.save("replacement-cookie")
        assertNull(recovery.retry()); assertNull(recovery.origin)
    }
}
