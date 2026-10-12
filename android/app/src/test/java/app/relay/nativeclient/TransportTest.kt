package app.relay.nativeclient

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class TransportTest {
    private val origin = "https://relay.example.com:4319"
    private val cookie = "__Host-relay_remote=test-session; Path=/; Secure; HttpOnly"
    @Test fun savedCookieMustBeHostOnlySecureAndHttpOnly() {
        assertTrue(RelayClient(origin, cookie).storedCookie().contains("test-session"))
        for (invalid in listOf(cookie.replace("; Secure", ""), cookie.replace("; HttpOnly", ""), "$cookie; Domain=relay.example.com", cookie.replace("Path=/", "Path=/other"), cookie.replace("__Host-relay_remote", "owner"))) {
            assertThrows(java.io.IOException::class.java) { RelayClient(origin, invalid).storedCookie() }
        }
    }
    @Test fun closedClientRefusesFurtherRequestsWithoutNetwork() = runBlocking {
        val client = RelayClient(origin, cookie)
        client.close()
        assertThrows(java.io.IOException::class.java) { client.storedCookie() }
        try {
            client.json("/api/session")
            fail("Closed client must not reconnect")
        } catch (e: java.io.IOException) { assertEquals("Session is closed.", e.message) }
    }
}
