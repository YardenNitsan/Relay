package app.relay.nativeclient

import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

data class PreparedAttachment(val name: String, val bytes: ByteArray, val document: Boolean, val text: String?)
object Attachments {
    fun prepare(name: String, input: InputStream): PreparedAttachment {
        require(name.isNotBlank() && name.length <= 180 && name.none { it == '/' || it == '\\' || it.code < 32 || it.code == 127 }) { "Choose a file with a safe name of at most 180 characters." }
        val extension = name.substringAfterLast('.', "").lowercase()
        val document = extension in setOf("pdf", "docx")
        require(extension !in setOf("doc", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "zip")) { "Choose UTF-8 text, PDF or a modern Word (.docx) document." }
        val limit = if (document) 8 * 1024 * 1024 else 240000
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            require(output.size() + count <= limit) { if (document) "Documents must be at most 8 MiB." else "Text files must be at most 240 KB." }
            output.write(buffer, 0, count)
        }
        val bytes = output.toByteArray()
        require(bytes.isNotEmpty()) { "The selected file is empty." }
        val text = if (document) null else try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: Exception) { throw IllegalArgumentException("The selected file is not valid UTF-8 text.") }
        require(text?.contains('\u0000') != true) { "Binary files are not supported. Choose text, PDF or .docx." }
        return PreparedAttachment(name, bytes, document, text)
    }
    fun appendReceipt(draft: String, path: String): String {
        require(path.startsWith("attachments/") && path.length <= 512 && path.none { it == '\\' || it.code < 32 || it.code == 127 } && path.split('/').none { it in listOf("", ".", "..") }) { "The host returned an invalid attachment path." }
        val next = draft + (if (draft.isBlank()) "" else "\n\n") + "Attached file: $path"
        require(next.length <= 32000) { "The attachment was uploaded, but the draft is too long to add its path. Open Projects to find the file." }
        return next
    }
}
