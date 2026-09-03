!include "common.nsh"
!include "extractAppPackage.nsh"

# Qnector persistent portable runtime cache.
# UNPACK_DIR_NAME is generated uniquely by electron-builder for each portable
# build, so different releases can never share an extracted runtime.
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif
  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir
  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  # Cache is local to this Windows user and unique to this exact portable build.
  StrCpy $INSTDIR "$LOCALAPPDATA\Qnector\PortableCache\${UNPACK_DIR_NAME}"

  # Reuse only a fully extracted cache. An interrupted extraction never writes
  # the marker and is rebuilt cleanly on the next launch.
  StrCpy $1 "1"
  IfFileExists "$INSTDIR\.qnector-cache-ready" 0 qnector_extract
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" qnector_launch qnector_extract

qnector_extract:
  StrCpy $1 "0"
  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        ${endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  FileOpen $0 "$INSTDIR\.qnector-cache-ready" w
  FileWrite $0 "${APP_EXECUTABLE_FILENAME}$\r$\n"
  FileClose $0

qnector_launch:
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("QNECTOR_PORTABLE_CACHE_ENABLED", "1").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("QNECTOR_PORTABLE_CACHE_HIT", "$1").r0'
  ${StdUtils.GetAllParameters} $R0 0

  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  SetErrorLevel $0
  SetOutPath $EXEDIR
SectionEnd
