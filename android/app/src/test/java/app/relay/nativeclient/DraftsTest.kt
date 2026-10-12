package app.relay.nativeclient

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.KeyGenerator

class DraftsTest {
    private class MemoryStorage : DraftStorage {
        val data = mutableMapOf<String, ByteArray>()
        override fun read(key: String) = data[key]
        override fun write(key: String, bytes: ByteArray) { data[key] = bytes }
        override fun remove(key: String) { data.remove(key) }
        override fun clear() { data.clear() }
    }
    private fun key() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    @Test fun acceptedOrClearedDraftReleasesStorageWithoutAllowingLateWrites() {
        val storage = MemoryStorage(); val stableKey = key(); val vault = DraftRepository(storage) { stableKey }
        val epoch = vault.activate("https://relay.test", "user-a")
        for (index in 0..120) {
            val id = "conversation-$index"
            vault.save(epoch, id, 1, DraftRecord("pending", "workspace"))
            vault.save(epoch, id, 3, DraftRecord("", "workspace"))
            assertFalse(vault.save(epoch, id, 2, DraftRecord("late")))
        }
        assertTrue(storage.data.isEmpty())
        vault.save(epoch, "uncertain", 1, DraftRecord("", uncertain = true))
        assertTrue(vault.load(epoch, "uncertain").uncertain)
    }
    @Test fun encryptedDraftSurvivesRepositoryRestartAndKeepsUncertainDelivery() {
        val storage = MemoryStorage(); val key = key(); val first = DraftRepository(storage) { key }
        val epoch = first.activate("https://relay.test", "user-a")
        val record = DraftRecord("Private draft שלום", "workspace", "coding", "local:model", true)
        assertTrue(first.save(epoch, "conversation", 1, record))
        assertFalse(storage.data.values.any { String(it).contains("Private draft") })
        val reopened = DraftRepository(storage) { key }
        assertEquals(record, reopened.load(reopened.activate("https://relay.test", "user-a"), "conversation"))
    }
    @Test fun accountHostAndConversationCannotShareOrReplayDrafts() {
        val storage = MemoryStorage(); val repository = DraftRepository(storage, ::key)
        val stableKey = key(); val vault = DraftRepository(storage) { stableKey }
        val epoch = vault.activate("https://relay.test", "user-a")
        vault.save(epoch, "one", 1, DraftRecord("secret"))
        assertEquals("", vault.load(epoch, "two").text)
        assertEquals("", vault.load(vault.activate("https://other.test", "user-a"), "one").text)
        assertEquals("", vault.load(vault.activate("https://relay.test", "user-b"), "one").text)
        val current = vault.activate("https://relay.test", "user-a")
        assertFalse(vault.save(epoch, "one", 20, DraftRecord("late old-account write")))
        assertEquals("secret", vault.load(current, "one").text)
        assertEquals("", repository.load(repository.activate("https://relay.test", "user-a"), "one").text)
    }
    @Test fun revocationAndOutOfOrderWritesCannotResurrectDraft() {
        val storage = MemoryStorage(); val stableKey = key(); val vault = DraftRepository(storage) { stableKey }
        val epoch = vault.activate("https://relay.test", "user-a")
        vault.save(epoch, "new", 2, DraftRecord("latest"))
        assertFalse(vault.save(epoch, "new", 1, DraftRecord("older")))
        assertEquals("latest", vault.load(epoch, "new").text)
        vault.clear()
        assertFalse(vault.save(epoch, "new", 3, DraftRecord("delayed")))
        assertTrue(storage.data.isEmpty())
    }
    @Test fun acknowledgementClearsOnlySubmittedTextAndAlwaysResolvesUncertainty() {
        assertEquals(DraftRecord(), acknowledgedDraft(DraftRecord("sent", uncertain = true), "sent"))
        assertEquals(DraftRecord("new typing"), acknowledgedDraft(DraftRecord("new typing", uncertain = true), "sent"))
    }
    @Test fun tamperedEncryptedDraftNeverLoads() {
        val storage = MemoryStorage(); val stableKey = key(); val vault = DraftRepository(storage) { stableKey }
        val epoch = vault.activate("https://relay.test", "user-a")
        assertTrue(vault.save(epoch, "new", 1, DraftRecord("secret")))
        storage.data.values.single().let { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        assertEquals(DraftRecord(), vault.load(epoch, "new"))
    }
}
