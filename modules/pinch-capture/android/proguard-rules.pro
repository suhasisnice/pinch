# Android instantiates the receiver and listener by the class names in the
# manifest; R8 must not rename or drop them.
-keep class com.suhasisnice.pinchcapture.** { *; }
