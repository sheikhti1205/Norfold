package com.findback.app.map

import java.io.File
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node

/**
 * Source contract for the native map screen. The Activity is inflated by the
 * platform, so the JVM suite can still assert the structural invariants the
 * redesign depends on: the map keeps the remaining height, every edit action
 * lives in one bottom panel outside the map, the readout wraps instead of
 * truncating, Search keeps its explicit IME submit, and every control keeps a
 * 48dp target. Rendering and system-bar appearance stay on-device.
 */
class MapScreenContractTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"

    @Test fun `edit actions sit in one bottom panel outside the map`() {
        val layout = layout()
        val panel = element(layout, "map_action_panel")
        assertEquals("map_root", id(panel.parentNode))
        assertTrue(ancestors(element(layout, "map_confirm")).contains("map_action_panel"))
        assertTrue(ancestors(element(layout, "map_readout")).contains("map_action_panel"))
        assertTrue(ancestors(element(layout, "map_my_location")).contains("map_action_panel"))
        // The panel must not be painted over the map or nested in its canvas.
        assertFalse(ancestors(panel).contains("map_view"))
        assertFalse(ancestors(panel).contains("map_canvas"))
    }

    @Test fun `map keeps the remaining height`() {
        val layout = layout()
        val canvas = element(layout, "map_view").parentNode as Element
        assertEquals("1", canvas.attr("layout_weight"))
        assertEquals("0dp", canvas.attr("layout_height"))
        assertEquals("match_parent", element(layout, "map_view").attr("layout_width"))
    }

    @Test fun `readout wraps instead of ellipsizing`() {
        val readout = element(layout(), "map_readout")
        assertTrue(readout.attr("ellipsize").isEmpty())
        assertFalse(readout.attr("singleLine") == "true")
        val maxLines = readout.attr("maxLines")
        assertTrue(maxLines.isEmpty() || (maxLines.toIntOrNull() ?: 0) >= 2)
        assertTrue(ancestors(readout).contains("map_action_panel"))
        assertFalse(ancestors(readout).contains("map_view"))
    }

    @Test fun `search keeps an explicit named action and IME submit`() {
        val layout = layout()
        val input = element(layout, "map_search_input")
        assertEquals("actionSearch", input.attr("imeOptions"))
        assertEquals("120", input.attr("maxLength"))
        assertEquals(
            "@string/findback_map_search",
            element(layout, "map_search_button").attr("text"),
        )
        assertEquals("Search", stringResource("findback_map_search"))
    }

    @Test fun `every control keeps a 48dp target`() {
        val layout = layout()
        for (id in listOf(
            "map_back",
            "map_search_input",
            "map_search_button",
            "map_my_location",
            "map_confirm",
            "map_retry",
        )) {
            val control = element(layout, id)
            val effective = maxOf(dp(control, "minHeight"), dp(control, "layout_height"))
            assertTrue("$id should keep a 48dp target, found ${effective}dp", effective >= 48)
        }
    }

    @Test fun `text actions use sentence case`() {
        val layout = layout()
        for (id in listOf("map_confirm", "map_search_button", "map_retry")) {
            assertEquals("$id should follow sentence case", "false", element(layout, id).attr("textAllCaps"))
        }
        for (name in listOf(
            "findback_map_confirm",
            "findback_map_search",
            "findback_map_retry",
            "findback_map_use_my_location",
        )) {
            val value = stringResource(name)
            assertFalse("$name should not be shouted: $value", value == value.uppercase(Locale.US))
            assertEquals("$name should start with a capital: $value", value.first().uppercaseChar(), value.first())
        }
        assertTrue(stringResource("findback_map_confirm").startsWith("Confirm"))
    }

    @Test fun `missing key is a distinct build message without retry`() {
        val unavailable = stringResource("findback_map_unavailable_build")
        assertNotEquals(stringResource("findback_map_style_failed"), unavailable)
        assertTrue(unavailable.isNotBlank())
        val source = activitySource()
        assertTrue(
            Regex("""R\.string\.findback_map_unavailable_build\)\s*,\s*showRetry\s*=\s*false""")
                .containsMatchIn(source),
        )
        assertTrue(
            Regex("""R\.string\.findback_map_style_failed\)\s*,\s*showRetry\s*=\s*true""")
                .containsMatchIn(source),
        )
    }

    @Test fun `viewer hides the picker pin and marks the saved coordinate`() {
        val source = activitySource()
        assertTrue(source.contains("MapValidation.showsCenterPin(isPicker, mapEnabled)"))
        assertTrue(source.contains("MapValidation.showsViewerMarker(isPicker, draftLat, draftLng)"))
        assertTrue(source.contains("googleMap.addMarker(MarkerOptions().position(initialCamera()))"))
    }

    @Test fun `named results row keeps a 48dp accessible target`() {
        val row = parse("src/main/res/layout/findback_map_result_row.xml")
        val minHeight = row.documentElement.attr("minHeight").removeSuffix("dp").toIntOrNull() ?: 0
        assertTrue("result row should keep a 48dp target", minHeight >= 48)
        assertEquals("15sp", element(row, "map_result_name").attr("textSize"))
        assertEquals("13sp", element(row, "map_result_coords").attr("textSize"))
        val source = activitySource()
        assertTrue(source.contains("R.layout.findback_map_result_row"))
        assertTrue(source.contains("15f * uiTextScale"))
    }

    // region source lookup

    private fun layout(): Document = parse("src/main/res/layout/activity_findback_map.xml")

    private fun activitySource(): String =
        resourceFile("src/main/java/com/findback/app/map/FindbackMapActivity.kt").readText()

    private fun resourceFile(relative: String): File {
        // Gradle's Test working directory is normally the app module; the
        // direct candidates and the upward walk keep the source contract
        // readable from the Android project, the repository, or a build dir.
        val direct = listOf(
            File("."),
            File("app"),
            File("apps/mobile/android/app"),
        ).map { File(it, relative) }
        direct.firstOrNull { it.isFile }?.let { return it.canonicalFile }
        var directory: File? = File(".").canonicalFile
        while (directory != null) {
            val candidate = File(directory, relative)
            if (candidate.isFile) return candidate
            val fromRepo = File(directory, "apps/mobile/android/app/$relative")
            if (fromRepo.isFile) return fromRepo
            directory = directory.parentFile
        }
        throw AssertionError("Missing $relative (searched from ${File(".").absolutePath})")
    }

    private fun parse(relative: String): Document {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = true
        return factory.newDocumentBuilder().parse(resourceFile(relative))
    }

    private fun element(document: Document, id: String): Element {
        val nodes = document.getElementsByTagName("*")
        for (index in 0 until nodes.length) {
            val candidate = nodes.item(index) as? Element ?: continue
            if (candidate.attr("id") == "@+id/$id" || candidate.attr("id") == "@id/$id") {
                return candidate
            }
        }
        throw AssertionError("Missing @id/$id")
    }

    private fun stringResource(name: String): String {
        val document = parse("src/main/res/values/findback_map_strings.xml")
        val nodes = document.getElementsByTagName("string")
        for (index in 0 until nodes.length) {
            val candidate = nodes.item(index) as? Element ?: continue
            if (candidate.getAttribute("name") == name) return candidate.textContent.trim()
        }
        throw AssertionError("Missing @string/$name")
    }

    private fun Element.attr(name: String): String = getAttributeNS(androidNs, name).orEmpty()

    private fun id(node: Node?): String = (node as? Element)?.attr("id")?.substringAfter("/").orEmpty()

    private fun ancestors(element: Element): List<String> {
        val ids = mutableListOf<String>()
        var node: Node? = element
        while (node is Element) {
            ids += id(node)
            node = node.parentNode
        }
        return ids
    }

    private fun dp(element: Element, name: String): Int =
        element.attr(name).removeSuffix("dp").toIntOrNull() ?: 0

    // endregion
}
