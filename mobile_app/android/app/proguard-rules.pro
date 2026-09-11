# ZegoCloud SDK uses reflection/JNI; keep it from being stripped in release builds.
-keep class **.zego.** { *; }
-keep class im.zego.** { *; }
