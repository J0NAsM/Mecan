# El puente JavaScript se invoca por reflexion desde la web: los metodos anotados no se renombran.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# Traza legible si una version publicada falla en un dispositivo real.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
