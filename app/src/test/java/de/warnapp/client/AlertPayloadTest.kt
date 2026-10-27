package de.warnapp.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertPayloadTest {
    @Test fun probeIsParsedAndIsAlarm() {
        val p = AlertPayload.from(mapOf("type" to "PROBE", "title" to "PROBEWARNUNG", "body" to "Test", "warningId" to "w1"))
        assertNotNull(p); assertEquals("PROBE", p!!.type); assertTrue(p.isAlarm)
    }
    @Test fun warningIsParsed() {
        val p = AlertPayload.from(mapOf("type" to "WARNING", "title" to "WARNUNG: X", "body" to "Y", "warningId" to "w2"))
        assertEquals("WARNUNG: X", p!!.title); assertTrue(p.isAlarm)
    }
    @Test fun allClearIsNoSiren() {
        val p = AlertPayload.from(mapOf("type" to "ALL_CLEAR", "body" to "ok", "warningId" to "w3"))
        assertFalse(p!!.isAlarm); assertEquals("ENTWARNUNG", p.title)
    }
    @Test fun unknownOrMissingTypeIsRejected() {
        assertNull(AlertPayload.from(mapOf("type" to "SIRENE")))
        assertNull(AlertPayload.from(emptyMap()))
    }
}
