package app.relay.nativeclient

/** Line decoder; UTF-8 and byte bounds are enforced by the network reader. */
class SseDecoder {
    private var type = "message"
    private val data = StringBuilder()
    fun line(value: String): StreamFrame? {
        require(value.length <= 256 * 1024) { "Activity line is too large." }
        if (value.isEmpty()) {
            val result = if (data.isNotEmpty()) StreamFrame(type, data.toString().removeSuffix("\n")) else null
            data.setLength(0); type = "message"
            return result
        }
        if (value.startsWith("event:")) type = value.substring(6).removePrefix(" ")
        else if (value.startsWith("data:")) {
            data.append(value.substring(5).removePrefix(" ")).append('\n')
            require(data.length <= 256 * 1024) { "Activity frame is too large." }
        }
        return null
    }
}
