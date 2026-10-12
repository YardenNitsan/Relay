package app.relay.nativeclient

import org.junit.Assert.*
import org.junit.Test

class SseDecoderTest {
    @Test fun joinsDataLinesAndIgnoresHeartbeatAndRetry() {
        val decoder = SseDecoder()
        assertNull(decoder.line(": heartbeat"))
        assertNull(decoder.line("retry: 1500"))
        assertNull(decoder.line("event: activity"))
        assertNull(decoder.line("data: first"))
        assertNull(decoder.line("data: second"))
        assertEquals(StreamFrame("activity", "first\nsecond"), decoder.line(""))
        assertNull(decoder.line(""))
    }
    @Test fun resetsEventTypeBetweenFrames() {
        val decoder = SseDecoder()
        decoder.line("event: replay"); decoder.line("data: {}"); decoder.line("")
        decoder.line("data: {}"); assertEquals("message", decoder.line("")?.type)
    }
    @Test fun refusesOversizeFrames() {
        val decoder = SseDecoder()
        assertThrows(IllegalArgumentException::class.java) { repeat(300) { decoder.line("data: " + "x".repeat(1024)) } }
    }
}
