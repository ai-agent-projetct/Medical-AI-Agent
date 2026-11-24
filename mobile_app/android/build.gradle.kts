allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
// Some plugins (e.g. zego_express_engine_for_uikit: compileSdkVersion 31) compile against an SDK older than
// their own AndroidX dependencies allow (34+). Raise only those to 36; runtime behaviour is unchanged.
subprojects {
    if (!state.executed) afterEvaluate {
        extensions.findByType(com.android.build.api.dsl.LibraryExtension::class.java)?.let { lib ->
            if ((lib.compileSdk ?: 0) in 1..33) lib.compileSdk = 36
        }
    }
}
subprojects {
    project.evaluationDependsOn(":app")
}



tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
