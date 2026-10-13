import java.io.File

plugins { id("com.android.application"); id("org.jetbrains.kotlin.plugin.compose") }
android {
    namespace = "app.relay.nativeclient"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.relay.nativeclient"; minSdk = 26; targetSdk = 37; versionCode = 3; versionName = "0.3-lan"
        manifestPlaceholders["relayNetworkSecurityConfig"] = "@xml/network_security_config"
    }
    buildFeatures { compose = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes { release { isMinifyEnabled = true; isShrinkResources = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") } }
    testOptions { unitTests.isReturnDefaultValues = true }
}

// Public trust material is an explicit local debug-build input, never an app
// preference. Omitting it does not include generated resources from prior builds.
val generatorClasses = layout.buildDirectory.dir("lan-trust/classes")
val generatedLanResources = layout.buildDirectory.dir("generated/lan-trust/res")
val jdkBin = File(System.getProperty("java.home"), "bin")
val executableSuffix = if (System.getProperty("os.name").startsWith("Windows")) ".exe" else ""
val compileLanTrustGenerator = tasks.register<Exec>("compileLanTrustGenerator") {
    val sources = rootProject.files("build-tools/LanTrustConfig.java", "build-tools/LanTrustConfigTest.java")
    inputs.files(sources)
    inputs.property("jdkVersion", System.getProperty("java.version"))
    outputs.dir(generatorClasses)
    doFirst { generatorClasses.get().asFile.mkdirs() }
    commandLine(listOf(jdkBin.resolve("javac$executableSuffix").absolutePath, "--release", "17", "-d", generatorClasses.get().asFile.absolutePath) + sources.files.map { it.absolutePath })
}
val checkLanTrustConfig = tasks.register<Exec>("checkLanTrustConfig") {
    dependsOn(compileLanTrustGenerator)
    commandLine(jdkBin.resolve("java$executableSuffix").absolutePath, "-cp", generatorClasses.get().asFile.absolutePath, "LanTrustConfigTest")
}
tasks.matching { it.name == "check" }.configureEach { dependsOn(checkLanTrustConfig) }
val lanCaFile = providers.gradleProperty("relayLanCaFile")
if (lanCaFile.isPresent) {
    require(lanCaFile.get().isNotBlank()) { "relayLanCaFile must name one public CA PEM or DER file." }
    val certificate = rootProject.file(lanCaFile.get())
    val generateLanTrustConfig = tasks.register<Exec>("generateLanTrustConfig") {
        dependsOn(compileLanTrustGenerator)
        inputs.file(certificate)
        inputs.property("exactLanHost", "10.100.102.30")
        outputs.dir(generatedLanResources)
        // Revalidate certificate dates even when the file has not changed.
        outputs.upToDateWhen { false }
        commandLine(jdkBin.resolve("java$executableSuffix").absolutePath, "-cp", generatorClasses.get().asFile.absolutePath, "LanTrustConfig", certificate.absolutePath, "10.100.102.30", generatedLanResources.get().asFile.absolutePath)
    }
    android.sourceSets.getByName("debug").res.directories.add(generatedLanResources.get().asFile.absolutePath)
    android.buildTypes.getByName("debug").manifestPlaceholders["relayNetworkSecurityConfig"] = "@xml/relay_lan_network_security_config"
    tasks.matching { it.name == "preDebugBuild" }.configureEach { dependsOn(generateLanTrustConfig) }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3.adaptive:adaptive:1.3.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
    testImplementation("com.squareup.okhttp3:mockwebserver3:5.5.0")
    testImplementation("com.squareup.okhttp3:okhttp-tls:5.5.0")
}

// Optional real-host integration must rerun when opted in or host source changes.
tasks.withType<Test>().configureEach {
    val integration = providers.environmentVariable("RELAY_NATIVE_INTEGRATION").orElse("0")
    inputs.property("relayNativeIntegration", integration)
    environment("RELAY_NATIVE_INTEGRATION", integration.get())
    if (integration.get() == "1") {
        inputs.files(rootProject.file("../scripts/native-lan-fixture.ts"), rootProject.file("../server"),
            rootProject.file("../shared"), rootProject.file("../package-lock.json"))
    }
}
