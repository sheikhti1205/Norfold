package com.findback.app.push

import org.junit.Assert.*
import org.junit.Test

class PushPresenceTest {
    private val conversation = "22222222-2222-4222-8222-222222222222"

    @Test fun `the open conversation suppresses its own chat push`() {
        assertTrue(PushPresence.isChatOpen("/chats/$conversation", conversation, true))
    }

    @Test fun `a different conversation never suppresses`() {
        val other = "44444444-4444-4444-8444-444444444444"
        assertFalse(PushPresence.isChatOpen("/chats/$other", conversation, true))
    }

    @Test fun `a prefix is not the conversation`() {
        // Exact path equality: `/chats/abc` must not stand in for `/chats/abc…`.
        assertFalse(PushPresence.isChatOpen("/chats/22222222", conversation, true))
        assertFalse(PushPresence.isChatOpen("/chats/$conversation-extra", conversation, true))
    }

    @Test fun `a background app never suppresses`() {
        assertFalse(PushPresence.isChatOpen("/chats/$conversation", conversation, false))
    }

    @Test fun `an unknown route never suppresses`() {
        assertFalse(PushPresence.isChatOpen(null, conversation, true))
        assertFalse(PushPresence.isChatOpen("", conversation, true))
        assertFalse(PushPresence.isChatOpen("   ", conversation, true))
        // Not a rooted path, so it is not a screen we can match.
        assertFalse(PushPresence.isChatOpen("chats/$conversation", conversation, true))
    }

    @Test fun `an empty conversation id never suppresses`() {
        assertFalse(PushPresence.isChatOpen("/chats/", "", true))
        assertFalse(PushPresence.isChatOpen("/chats/", null, true))
    }

    @Test fun `the same route with a query or fragment still suppresses`() {
        assertTrue(PushPresence.isChatOpen("/chats/$conversation?x=1", conversation, true))
        assertTrue(PushPresence.isChatOpen("/chats/$conversation#detail", conversation, true))
        assertTrue(PushPresence.isChatOpen("/chats/$conversation?x=1#detail", conversation, true))
        assertTrue(PushPresence.isChatOpen("/chats/$conversation#detail?x=1", conversation, true))
    }

    @Test fun `other screens are not the conversation`() {
        assertFalse(PushPresence.isChatOpen("/", conversation, true))
        assertFalse(PushPresence.isChatOpen("/posts/p1", conversation, true))
        assertFalse(PushPresence.isChatOpen("/chats", conversation, true))
    }

    @Test fun `a malformed report fails open to no screen`() {
        assertEquals("/chats/$conversation", PushPresence.setRoute("/chats/$conversation"))
        assertEquals("/chats/$conversation", PushPresence.activeRoute)
        assertEquals("", PushPresence.setRoute(null))
        assertEquals("", PushPresence.activeRoute)
        assertEquals("", PushPresence.setRoute("https://findbackapp.social/chats/$conversation"))
        assertEquals("", PushPresence.activeRoute)
        assertEquals("", PushPresence.setRoute("/" + "a".repeat(600)))
        assertEquals("", PushPresence.activeRoute)
    }

    @Test fun `a stored route is trimmed and matched`() {
        PushPresence.setRoute("  /chats/$conversation  ")
        assertEquals("/chats/$conversation", PushPresence.activeRoute)
        assertTrue(PushPresence.isChatOpen(PushPresence.activeRoute, conversation, true))
    }
}
