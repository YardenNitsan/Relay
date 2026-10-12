package app.relay.nativeclient

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class AttachmentsTest {
    @Test fun textIsStrictUtf8AndRejectsBinaryOrExcessiveContent() {
        val prepared = Attachments.prepare("notes.txt", "שלום\n".byteInputStream())
        assertEquals("שלום\n", prepared.text)
        assertFalse(prepared.document)
        for (bytes in listOf(byteArrayOf(0), byteArrayOf(0xc3.toByte(), 0x28), ByteArray(240001))) {
            assertThrows(IllegalArgumentException::class.java) { Attachments.prepare("notes.txt", ByteArrayInputStream(bytes)) }
        }
    }
    @Test fun documentLimitAndDangerousNamesAreRefusedBeforeUpload() {
        assertTrue(Attachments.prepare("brief.PDF", "%PDF-test".byteInputStream()).document)
        for (name in listOf("../private.txt", "a/b.txt", "a\\b.txt", "control\n.txt", "", "a".repeat(181))) {
            assertThrows(IllegalArgumentException::class.java) { Attachments.prepare(name, "content".byteInputStream()) }
        }
        assertThrows(IllegalArgumentException::class.java) { Attachments.prepare("huge.pdf", ByteArrayInputStream(ByteArray(8 * 1024 * 1024 + 1))) }
    }
    @Test fun onlyAcknowledgedSafeRelativePathCanEnterDraft() {
        assertEquals("Read this\n\nAttached file: attachments/id/notes.txt", Attachments.appendReceipt("Read this", "attachments/id/notes.txt"))
        for (path in listOf("../secret", "attachments/../secret", "/root/file", "attachments/a\ninjected")) {
            assertThrows(IllegalArgumentException::class.java) { Attachments.appendReceipt("Draft", path) }
        }
        assertThrows(IllegalArgumentException::class.java) { Attachments.appendReceipt("x".repeat(32000), "attachments/id/file") }
    }
}
