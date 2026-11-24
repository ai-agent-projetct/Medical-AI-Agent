pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.5.2" apply false // 9.5+: API 37
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}

include(":app")

// Gradle 9 removed jcenter() (JCenter itself is shut down). The zego_zim plugin still calls it next to
// mavenCentral() in its Groovy build script, so give every project a no-op jcenter() instead of failing.
gradle.beforeProject {
    extensions.extraProperties["jcenter"] = closureOf<Any?> { }
}
