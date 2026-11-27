package com.findback.app.map

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.findback.app.BuildConfig
import com.findback.app.R
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.MapColorScheme
import com.google.android.gms.maps.model.Marker
import com.google.android.gms.maps.model.MarkerOptions
import com.google.android.gms.tasks.CancellationTokenSource

/**
 * Native map surface (MAP migration): Google Maps SDK [MapView] in its own
 * Activity — never embedded under the Capacitor WebView, so there is no
 * transparency/z-order/container-sync contract.
 *
 * Modes:
 * - picker: fixed center pin; the map moves underneath it. Camera-idle after
 *   a user gesture updates the DRAFT only — nothing is written to the report
 *   until Confirm. Cancel/system-Back returns CANCELED with no mutation.
 * - viewer: read-only camera on a committed coordinate (post detail tap). The
 *   saved coordinate is marked by a display-only SDK marker; the picker pin
 *   never appears.
 *
 * Search is explicit-submit Nominatim (≤1 req/s, ≤5 results, app User-Agent);
 * a result recenters the camera but never commits. Location is one-shot via
 * the fused provider — no tracking, no background permission.
 *
 * The map object is created only when the build carried a Maps key: a blank
 * key fails closed to the load-failure surface instead of an empty map.
 */
class FindbackMapActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_PICKER = "picker"
        const val MODE_VIEWER = "viewer"
        const val EXTRA_LATITUDE = "latitude"
        const val EXTRA_LONGITUDE = "longitude"
        const val EXTRA_ZOOM = "zoom"
        const val EXTRA_LABEL = "label"
        const val EXTRA_ALLOW_CURRENT_LOCATION = "allowCurrentLocation"
        const val EXTRA_APPEARANCE_THEME = "appearanceTheme"
        const val EXTRA_TEXT_SCALE = "textScale"

        private const val STATE_DRAFT_LAT = "draftLat"
        private const val STATE_DRAFT_LNG = "draftLng"
        private const val STATE_ZOOM = "zoom"

        private const val LOCATION_PERMISSION_CODE = 0xFB4A
        private const val LOCATION_TIMEOUT_MS = 15_000L
        private const val SEARCH_CAMERA_ANIMATION_MS = 1200

        /**
         * Stall budget for the SDK handshake (getMapAsync + first render).
         * Mirrors MapSnapshotService.SNAPSHOT_TIMEOUT_MS: a map that neither
         * delivers a GoogleMap nor finishes rendering reports the load failure
         * instead of spinning forever.
         */
        private const val MAP_LOAD_TIMEOUT_MS = 20_000L

        /**
         * Display-only neutral camera (central Bangladesh): used when no valid
         * initial coordinate was supplied. The draft stays null, so this can
         * never become a committed pin — Confirm waits for a user gesture.
         */
        private val NEUTRAL_CENTER = LatLng(23.70, 90.35)
        private const val NEUTRAL_ZOOM = 6.0
    }

    private lateinit var rootView: View
    private lateinit var mapView: MapView
    private lateinit var centerPin: View
    private var map: GoogleMap? = null
    private var mapEnabled = false
    private var mapViewInitialized = false
    private var mapLoaded = false
    private var mapFailed = false
    private val mapLoadTimeout = Handler(Looper.getMainLooper())
    private var destroyed = false

    private var isPicker = true
    private var nightMode = false
    private var draftLat: Double? = null
    private var draftLng: Double? = null
    private var draftZoom: Double = MapValidation.DEFAULT_ZOOM
    private var lastGestureMove = false
    private var searching = false
    private var locating = false
    private var locationCancel: CancellationTokenSource? = null
    private val locationTimeout = Handler(Looper.getMainLooper())
    // Process-wide ≤1 req/s throttle shared at provider level — never a
    // per-Activity instance (explicit-submit only, no autocomplete).
    private val searchGate: NominatimGate = NominatimClient.sharedGate
    private var searchGeneration = 0
    private var searchResults: List<NominatimResult> = emptyList()

    private lateinit var titleView: TextView
    private lateinit var confirmButton: Button
    private lateinit var searchRow: View
    private lateinit var searchInput: EditText
    private lateinit var searchButton: Button
    private lateinit var resultsList: ListView
    private lateinit var resultsCard: View
    private lateinit var loading: ProgressBar
    private lateinit var readout: TextView
    private lateinit var statusRow: View
    private lateinit var statusText: TextView
    private lateinit var retryButton: Button
    private lateinit var footer: View
    private lateinit var myLocationButton: ImageButton
    private var viewerMarker: Marker? = null
    private var appearanceTheme: String? = null
    private var uiTextScale = 1f

    // region lifecycle

    override fun onCreate(savedInstanceState: Bundle?) {
        // The picker/viewer follows the app's resolved theme, not only the OS.
        // AppCompat applies the local mode before the hierarchy is inflated.
        appearanceTheme = MapValidation.appearanceTheme(intent.getStringExtra(EXTRA_APPEARANCE_THEME))
        when (appearanceTheme) {
            "light" -> delegate.localNightMode = AppCompatDelegate.MODE_NIGHT_NO
            "dark", "amoled" -> delegate.localNightMode = AppCompatDelegate.MODE_NIGHT_YES
        }
        super.onCreate(savedInstanceState)
        // Edge-to-edge with the system-bar padding owned by the root view
        // below: the title clears the status bar and the footer clears the
        // gesture bar. WindowCompat.enableEdgeToEdge is 1.17.0+; the app
        // compiles against core 1.15.0 (appcompat 1.7.1 requires 1.13.0,
        // credentials 1.6.0 requires 1.15.0), so use the 1.5.0 call that
        // enableEdgeToEdge itself wraps.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_findback_map)

        isPicker = intent.getStringExtra(EXTRA_MODE) != MODE_VIEWER
        nightMode = isNightMode()
        bindViews()
        applyAppTextScale()
        applyAmoledSurface()
        applyWindowInsets()
        applySystemBarAppearance()
        restoreDraft(savedInstanceState)

        titleView.text = initialTitle()
        confirmButton.visibility = if (isPicker) View.VISIBLE else View.GONE
        searchRow.visibility = if (isPicker) View.VISIBLE else View.GONE
        footer.visibility = if (isPicker) View.VISIBLE else View.GONE
        myLocationButton.visibility =
            if (isPicker && intent.getBooleanExtra(EXTRA_ALLOW_CURRENT_LOCATION, true)) View.VISIBLE else View.GONE

        confirmButton.isEnabled = draftLat != null && draftLng != null
        updateReadout()

        // Fail closed before the MapView is ever created: a build without a
        // key must not initialise the SDK or show an empty map rectangle.
        mapEnabled = BuildConfig.GOOGLE_MAPS_ANDROID_API_KEY.isNotBlank()
        centerPin.visibility =
            if (MapValidation.showsCenterPin(isPicker, mapEnabled)) View.VISIBLE else View.GONE
        if (mapEnabled) {
            mapViewInitialized = true
            mapView.onCreate(savedInstanceState)
            requestMap()
        } else {
            mapView.visibility = View.GONE
            onMapUnavailable()
        }

        findViewById<ImageButton>(R.id.map_back).setOnClickListener { cancelAndClose() }
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = cancelAndClose()
        })
        confirmButton.setOnClickListener { confirmAndClose() }
        searchButton.setOnClickListener { submitSearch() }
        searchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                submitSearch()
                true
            } else false
        }
        resultsList.setOnItemClickListener { _, _, position, _ ->
            searchResults.getOrNull(position)?.let { pickSearchResult(it) }
        }
        retryButton.setOnClickListener { retryMapLoad() }
        myLocationButton.setOnClickListener { useMyLocationOnce() }
    }

    override fun onStart() {
        super.onStart()
        if (mapViewInitialized) mapView.onStart()
    }

    override fun onResume() {
        super.onResume()
        if (mapViewInitialized) mapView.onResume()
    }

    override fun onPause() {
        super.onPause()
        if (mapViewInitialized) mapView.onPause()
    }

    override fun onStop() {
        super.onStop()
        if (mapViewInitialized) mapView.onStop()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        if (mapViewInitialized) mapView.onLowMemory()
    }

    override fun onDestroy() {
        destroyed = true
        searchGeneration += 1
        locationTimeout.removeCallbacksAndMessages(null)
        locationCancel?.cancel()
        mapLoadTimeout.removeCallbacksAndMessages(null)
        viewerMarker = null
        map = null
        if (mapViewInitialized) mapView.onDestroy()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (mapViewInitialized) mapView.onSaveInstanceState(outState)
        draftLat?.let { outState.putDouble(STATE_DRAFT_LAT, it) }
        draftLng?.let { outState.putDouble(STATE_DRAFT_LNG, it) }
        outState.putDouble(STATE_ZOOM, draftZoom)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // The manifest keeps the Activity alive across uiMode changes. The
        // screen is colour-scoped to the DayNight palette, so the hierarchy is
        // rebuilt for a theme switch instead of keeping the previous
        // configuration's resolved colours; the map, draft and camera are
        // restored through the normal saved-state path.
        val night = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        if (appearanceTheme == null && night != nightMode) {
            recreate()
            return
        }
        applySystemBarAppearance()
        if (resultsCard.visibility == View.VISIBLE) {
            // Wait for the new orientation to lay out before re-capping the
            // overlay against the map's new height.
            resultsCard.post {
                if (!destroyed && resultsCard.visibility == View.VISIBLE) showResultsCard()
            }
        }
    }

    // endregion

    // region picker state

    private fun bindViews() {
        rootView = findViewById(R.id.map_root)
        mapView = findViewById(R.id.map_view)
        centerPin = findViewById(R.id.map_center_pin)
        titleView = findViewById(R.id.map_title)
        confirmButton = findViewById(R.id.map_confirm)
        searchRow = findViewById(R.id.map_search_row)
        searchInput = findViewById(R.id.map_search_input)
        searchButton = findViewById(R.id.map_search_button)
        resultsList = findViewById(R.id.map_results)
        resultsCard = findViewById(R.id.map_results_card)
        loading = findViewById(R.id.map_loading)
        readout = findViewById(R.id.map_readout)
        statusRow = findViewById(R.id.map_status_row)
        statusText = findViewById(R.id.map_status)
        retryButton = findViewById(R.id.map_retry)
        footer = findViewById(R.id.map_footer)
        myLocationButton = findViewById(R.id.map_my_location)
    }

    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    // Preserves adjustResize now that the window is edge-to-edge:
                    // the IME is no longer applied by the framework.
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            windowInsets
        }
        ViewCompat.requestApplyInsets(rootView)
    }

    /**
     * The map is no longer overlaid by a readout strip, so the SDK's default
     * padding already keeps the Google logo and legal notices visible. System
     * bar icons follow the DayNight surface behind them; API 24-25 cannot draw
     * dark navigation icons, so those releases keep an opaque dark nav bar.
     */
    @Suppress("DEPRECATION")
    private fun applySystemBarAppearance() {
        val night = isNightMode()
        window.statusBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.navigationBarColor = Color.TRANSPARENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.isNavigationBarContrastEnforced = false
            }
        } else {
            window.navigationBarColor = Color.BLACK
        }
        WindowInsetsControllerCompat(window, rootView).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }
    }

    /**
     * Norfold's app text scale is a root font multiplier. Native `sp` already
     * carries the platform font scale, so the app/platform ratio replaces that
     * scale instead of stacking a second one. Rows created after inflation
     * reuse [uiTextScale] in their adapter; both text paths therefore end at
     * the app's chosen size exactly once.
     */
    private fun applyAppTextScale() {
        val appScale = MapValidation.appTextScale(
            intent.getDoubleExtra(EXTRA_TEXT_SCALE, Double.NaN).takeIf { it.isFinite() },
        ) ?: return
        val systemScale = resources.configuration.fontScale
            .takeIf { it.isFinite() && it > 0f } ?: 1f
        val ratio = appScale / systemScale
        if (!ratio.isFinite() || ratio <= 0f) return
        uiTextScale = ratio
        if (ratio != 1f) scaleText(rootView, ratio)
    }

    private fun scaleText(view: View, ratio: Float) {
        if (view is TextView) view.setTextSize(TypedValue.COMPLEX_UNIT_PX, view.textSize * ratio)
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) scaleText(view.getChildAt(index), ratio)
        }
    }

    /**
     * AMOLED differs from dark only in the page surface role and in having no
     * shadows; every other map role already matches the same dark tokens.
     */
    private fun applyAmoledSurface() {
        if (appearanceTheme != "amoled") return
        rootView.setBackgroundColor(Color.BLACK)
        resultsCard.elevation = 0f
        findViewById<View>(R.id.map_action_panel)?.elevation = 0f
    }

    private fun restoreDraft(saved: Bundle?) {
        if (saved != null) {
            val lat = saved.getDouble(STATE_DRAFT_LAT, Double.NaN)
            val lng = saved.getDouble(STATE_DRAFT_LNG, Double.NaN)
            if (MapValidation.isValidCenter(lat.takeIf { it.isFinite() }, lng.takeIf { it.isFinite() })) {
                draftLat = lat
                draftLng = lng
            }
            draftZoom = MapValidation.clampZoom(saved.getDouble(STATE_ZOOM, MapValidation.DEFAULT_ZOOM))
            return
        }
        val lat = intent.getDoubleExtra(EXTRA_LATITUDE, Double.NaN).takeIf { it.isFinite() }
        val lng = intent.getDoubleExtra(EXTRA_LONGITUDE, Double.NaN).takeIf { it.isFinite() }
        // Invalid initial coordinates seed a neutral display-only camera —
        // never a fabricated draft.
        if (MapValidation.isValidCenter(lat, lng)) {
            draftLat = lat
            draftLng = lng
            draftZoom = MapValidation.clampZoom(
                intent.getDoubleExtra(EXTRA_ZOOM, MapValidation.DEFAULT_ZOOM).takeIf { it.isFinite() },
            )
        } else {
            // Neutral display-only camera (central Bangladesh). The draft
            // stays null — Confirm enables only after a user gesture — and
            // the seed zoom is ignored so a world-zoom seed cannot override
            // the neutral framing.
            draftZoom = NEUTRAL_ZOOM
        }
    }

    private fun initialTitle(): String {
        if (!isPicker) {
            val label = intent.getStringExtra(EXTRA_LABEL)?.trim().orEmpty()
            return label.ifEmpty { getString(R.string.findback_map_view) }
        }
        return getString(R.string.findback_map_choose_location)
    }

    private fun initialCamera(): LatLng {
        val lat = draftLat
        val lng = draftLng
        return if (lat != null && lng != null) LatLng(lat, lng) else NEUTRAL_CENTER
    }

    private fun updateReadout() {
        val lat = draftLat
        val lng = draftLng
        readout.text = if (lat != null && lng != null) {
            String.format(java.util.Locale.US, "%.5f, %.5f", lat, lng)
        } else {
            getString(
                if (isPicker) R.string.findback_map_no_pin else R.string.findback_map_no_location,
            )
        }
    }

    private fun confirmAndClose() {
        val lat = draftLat
        val lng = draftLng
        if (lat == null || lng == null || !MapValidation.isValidCenter(lat, lng)) return
        val data = Intent()
            .putExtra(EXTRA_LATITUDE, lat)
            .putExtra(EXTRA_LONGITUDE, lng)
            .putExtra(EXTRA_ZOOM, draftZoom)
        setResult(Activity.RESULT_OK, data)
        finish()
    }

    private fun cancelAndClose() {
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    // endregion

    // region map loading

    /**
     * Requests the map through [MapView.getMapAsync] and arms the stall budget
     * first, so a callback that never arrives still reports the load failure.
     */
    private fun requestMap() {
        if (!mapEnabled || destroyed) return
        armMapLoadTimeout()
        mapView.getMapAsync { googleMap -> onMapReady(googleMap) }
    }

    private fun armMapLoadTimeout() {
        mapLoadTimeout.removeCallbacksAndMessages(null)
        mapLoadTimeout.postDelayed({
            if (!mapLoaded && !destroyed) onMapLoadFailed()
        }, MAP_LOAD_TIMEOUT_MS)
    }

    private fun onMapReady(googleMap: GoogleMap) {
        // Backed out before the map loaded: touch nothing — the Activity
        // is finishing and the MapView is (being) destroyed.
        if (destroyed || isFinishing || isDestroyed) return
        val firstReady = map == null
        map = googleMap
        // Match the app's resolved theme even when it differs from the OS
        // setting; with no bridged appearance the SDK keeps FOLLOW_SYSTEM.
        googleMap.setMapColorScheme(
            when (appearanceTheme) {
                "light" -> MapColorScheme.LIGHT
                "dark", "amoled" -> MapColorScheme.DARK
                else -> MapColorScheme.FOLLOW_SYSTEM
            },
        )
        if (firstReady) {
            viewerMarker = null
            googleMap.moveCamera(CameraUpdateFactory.newLatLngZoom(initialCamera(), draftZoom.toFloat()))
        }
        if (MapValidation.showsViewerMarker(isPicker, draftLat, draftLng) && viewerMarker == null) {
            // Display-only SDK marker for the committed coordinate: not
            // movable, not clickable, and it never feeds the result payload.
            viewerMarker = googleMap.addMarker(MarkerOptions().position(initialCamera()))
        }
        googleMap.setOnCameraMoveStartedListener { reason ->
            if (reason == GoogleMap.OnCameraMoveStartedListener.REASON_GESTURE) {
                lastGestureMove = true
            }
        }
        googleMap.setOnCameraIdleListener {
            val camera = googleMap.cameraPosition ?: return@setOnCameraIdleListener
            val target = camera.target ?: return@setOnCameraIdleListener
            draftZoom = camera.zoom.toDouble()
            if (isPicker && lastGestureMove) {
                lastGestureMove = false
                draftLat = target.latitude
                draftLng = target.longitude
                confirmButton.isEnabled = true
                updateReadout()
            } else if (!isPicker) {
                updateReadout()
            }
        }
        if (!mapLoaded) {
            googleMap.setOnMapLoadedCallback { onMapLoaded() }
        }
    }

    private fun onMapLoaded() {
        mapLoaded = true
        mapLoadTimeout.removeCallbacksAndMessages(null)
        hideLoading()
        // Only clear the failure surface this callback owns — a search or
        // location status may be on screen by the time rendering finishes.
        if (mapFailed) {
            mapFailed = false
            hideStatus()
        }
    }

    private fun onMapLoadFailed() {
        if (mapLoaded) return
        mapFailed = true
        mapLoadTimeout.removeCallbacksAndMessages(null)
        hideLoading()
        // Truthful failure: retry offered, Cancel works, and Confirm stays
        // available when a valid draft exists — never a fake loaded map.
        showStatus(getString(R.string.findback_map_style_failed), showRetry = true)
    }

    /**
     * No key means no map in this build: a truthful, non-retryable message.
     * A real transient load failure keeps its own message and Retry action.
     */
    private fun onMapUnavailable() {
        mapFailed = true
        hideLoading()
        showStatus(getString(R.string.findback_map_unavailable_build), showRetry = false)
    }

    private fun hideLoading() {
        loading.visibility = View.GONE
    }

    private fun isNightMode(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private fun retryMapLoad() {
        hideStatus()
        if (!mapEnabled) {
            onMapUnavailable()
            return
        }
        if (mapLoaded) return
        loading.visibility = View.VISIBLE
        requestMap()
    }

    private fun showStatus(message: String, showRetry: Boolean) {
        // A message supersedes the floating result card: the map and its
        // attribution stay clear while the panel explains what happened.
        resultsCard.visibility = View.GONE
        statusRow.visibility = View.VISIBLE
        statusText.text = message
        retryButton.visibility = if (showRetry) View.VISIBLE else View.GONE
    }

    private fun hideStatus() {
        statusRow.visibility = View.GONE
        retryButton.visibility = View.GONE
    }

    // endregion

    // region explicit-submit search

    private fun submitSearch() {
        if (!isPicker || searching) return
        hideKeyboard()
        val query = searchInput.text?.toString()?.trim().orEmpty()
        if (query.isEmpty()) {
            showStatus(getString(R.string.findback_map_empty_query), showRetry = false)
            return
        }
        val waitMs = searchGate.retryAfterMs(System.currentTimeMillis())
        if (waitMs > 0) {
            showStatus(getString(R.string.findback_map_rate_limited), showRetry = false)
            return
        }
        searching = true
        searchButton.isEnabled = false
        showStatus(getString(R.string.findback_map_searching), showRetry = false)
        val userAgent = userAgent()
        // Canonical search endpoint seam: BuildConfig value validated with the
        // MapValidation default as the fallback (no secret). validateSearchEndpoint
        // never throws (it returns the fallback) — no try/catch by design.
        val endpoint = MapValidation.validateSearchEndpoint(BuildConfig.MAP_SEARCH_URL)
        searchGeneration += 1
        val requestGeneration = searchGeneration
        Thread {
            val outcome: Result<List<NominatimResult>> = try {
                Result.success(
                    NominatimClient.fetchResults(
                        endpoint,
                        query,
                        userAgent,
                    ),
                )
            } catch (e: NominatimException) {
                Result.failure(e)
            } catch (e: Exception) {
                Result.failure(NominatimException(NominatimException.Kind.NETWORK, "Place search could not connect."))
            }
            runOnUiThread { onSearchFinished(query, outcome, requestGeneration) }
        }.start()
    }

    private fun onSearchFinished(query: String, outcome: Result<List<NominatimResult>>, requestGeneration: Int = searchGeneration) {
        // A destroyed/finishing Activity or a stale generation must die
        // silently — never touch UI after the lifecycle ended.
        if (!MapValidation.isSearchDeliveryAlive(requestGeneration, searchGeneration, destroyed, isFinishing || isDestroyed)) return
        searching = false
        searchButton.isEnabled = true
        // A stale response (newer search started) never overwrites the list:
        // the input must still match the submitted query. Its "Searching…"
        // status is stale too, so clear it instead of leaving it on screen.
        if (searchInput.text?.toString()?.trim() != query) {
            hideStatus()
            return
        }
        outcome.fold(
            onSuccess = { places ->
                searchResults = places
                if (places.isEmpty()) {
                    resultsCard.visibility = View.GONE
                    showStatus(getString(R.string.findback_map_no_results), showRetry = false)
                } else {
                    hideStatus()
                    resultsList.adapter = SearchResultAdapter(places)
                    showResultsCard()
                }
            },
            onFailure = { error ->
                resultsCard.visibility = View.GONE
                val message = when ((error as? NominatimException)?.kind) {
                    NominatimException.Kind.RATE_LIMITED ->
                        getString(R.string.findback_map_rate_limited)
                    NominatimException.Kind.NETWORK ->
                        getString(R.string.findback_map_search_offline)
                    else -> getString(R.string.findback_map_search_failed)
                }
                showStatus(message, showRetry = false)
            },
        )
    }

    /**
     * The results card is capped to the upper share of the current map height
     * so a 320dp/large-font screen never gets an overlay taller than the map
     * it belongs to and the centre pin plus map attribution stay visible.
     * The list stays scrollable to all five results.
     */
    private fun showResultsCard() {
        val canvasHeight = (resultsCard.parent as? View)?.height ?: 0
        if (canvasHeight > 0) {
            val preferred = (200 * resources.displayMetrics.density).toInt()
            val params = resultsCard.layoutParams
            params.height = minOf(preferred, (canvasHeight * 0.4f).toInt())
            resultsCard.layoutParams = params
        }
        resultsCard.visibility = View.VISIBLE
    }

    /**
     * Two-line result row in app colours: place name (wraps to two lines) and
     * the coordinate pair the result would recenter to. Selection only
     * recenters the camera — nothing is committed until Confirm. The row owns
     * its 48dp target and reuses the app text ratio for dynamic rows.
     */
    private inner class SearchResultAdapter(results: List<NominatimResult>) :
        ArrayAdapter<NominatimResult>(
            this,
            R.layout.findback_map_result_row,
            R.id.map_result_name,
            results,
        ) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = super.getView(position, convertView, parent)
            val result = getItem(position)
            view.findViewById<TextView>(R.id.map_result_name)?.apply {
                text = result?.displayName.orEmpty()
                if (uiTextScale != 1f) setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f * uiTextScale)
            }
            view.findViewById<TextView>(R.id.map_result_coords)?.apply {
                text = result?.let {
                    String.format(java.util.Locale.US, "%.5f, %.5f", it.latitude, it.longitude)
                }.orEmpty()
                if (uiTextScale != 1f) setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f * uiTextScale)
            }
            return view
        }
    }

    private fun pickSearchResult(result: NominatimResult) {
        val center = LatLng(result.latitude, result.longitude)
        draftLat = result.latitude
        draftLng = result.longitude
        confirmButton.isEnabled = true
        updateReadout()
        resultsCard.visibility = View.GONE
        map?.animateCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder().target(center).zoom(draftZoom.toFloat()).build(),
            ),
            SEARCH_CAMERA_ANIMATION_MS,
            null,
        )
    }

    private fun hideKeyboard() {
        val imm = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager ?: return
        imm.hideSoftInputFromWindow(searchInput.windowToken, 0)
    }

    private fun userAgent(): String {
        val version = try {
            BuildConfig.VERSION_NAME
        } catch (e: Exception) {
            "unknown"
        }
        val contact = try {
            BuildConfig.MAP_SEARCH_CONTACT
        } catch (e: Exception) {
            "unknown"
        }
        return NominatimClient.userAgent(version, contact)
    }

    // endregion

    // region one-shot location

    private fun useMyLocationOnce() {
        if (!isPicker || locating) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION),
                LOCATION_PERMISSION_CODE,
            )
            return
        }
        fetchCurrentLocation()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCATION_PERMISSION_CODE) return
        if (grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
            fetchCurrentLocation()
        } else {
            // Denied: the map stays fully usable — no dead end, no re-prompt loop.
            showStatus(getString(R.string.findback_map_location_denied), showRetry = false)
        }
    }

    private fun fetchCurrentLocation() {
        locating = true
        myLocationButton.isEnabled = false
        showStatus(getString(R.string.findback_map_locating), showRetry = false)
        val source = CancellationTokenSource()
        locationCancel = source
        locationTimeout.postDelayed({
            if (locating) {
                source.cancel()
                onLocationFailed(getString(R.string.findback_map_location_timeout))
            }
        }, LOCATION_TIMEOUT_MS)
        try {
            LocationServices.getFusedLocationProviderClient(this)
                .getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, source.token)
                .addOnSuccessListener { location ->
                    if (!locating) return@addOnSuccessListener
                    if (location == null) {
                        onLocationFailed(getString(R.string.findback_map_location_unavailable))
                        return@addOnSuccessListener
                    }
                    locating = false
                    locationTimeout.removeCallbacksAndMessages(null)
                    myLocationButton.isEnabled = true
                    draftLat = location.latitude
                    draftLng = location.longitude
                    confirmButton.isEnabled = true
                    updateReadout()
                    map?.animateCamera(
                        CameraUpdateFactory.newLatLngZoom(LatLng(location.latitude, location.longitude), draftZoom.toFloat()),
                    )
                    showStatus(getString(R.string.findback_map_location_ready), showRetry = false)
                }
                .addOnFailureListener {
                    if (locating) onLocationFailed(getString(R.string.findback_map_location_unavailable))
                }
        } catch (e: SecurityException) {
            onLocationFailed(getString(R.string.findback_map_location_denied))
        } catch (e: Exception) {
            onLocationFailed(getString(R.string.findback_map_location_unavailable))
        }
    }

    private fun onLocationFailed(message: String) {
        locating = false
        locationTimeout.removeCallbacksAndMessages(null)
        myLocationButton.isEnabled = true
        showStatus(message, showRetry = false)
    }

    // endregion
}
