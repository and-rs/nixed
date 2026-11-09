{
  lib,
  stdenv,
  stdenvNoCC,
  fetchFromGitHub,
  fetchurl,
  autoPatchelfHook,
  autoAddDriverRunpath,
  cmake,
  ninja,
  pkg-config,
  obs-studio,
  opencv,
  qt6,
  curl,
  cudaPackages,
}:

let
  # Upstream ships both GPU providers; avoid compiling ONNX Runtime's CUDA kernels.
  onnxruntimeWithTensorRT = stdenvNoCC.mkDerivation rec {
    pname = "onnxruntime-gpu-bin";
    version = "1.23.2";

    src = fetchurl {
      url = "https://github.com/microsoft/onnxruntime/releases/download/v${version}/onnxruntime-linux-x64-gpu-${version}.tgz";
      hash = "sha256-IIPjYQcqec4WqQ3NX1yzq5JXSoKjzgrAHlz6MVgXb1M=";
    };

    nativeBuildInputs = [
      autoPatchelfHook
      autoAddDriverRunpath
    ];
    buildInputs = [
      stdenv.cc.cc.lib
    ]
    ++ map lib.getLib (
      with cudaPackages;
      [
        cuda_cudart
        libcublas
        libcurand
        libcufft
        cudnn
        tensorrt
      ]
    );
    # Providers and TensorRT's builder/plugin libraries are loaded with dlopen.
    appendRunpaths = [
      "${placeholder "out"}/lib"
      "${lib.getLib cudaPackages.tensorrt}/lib"
    ];
    dontStrip = true;

    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -a include lib "$out/"
      install -Dm644 LICENSE "$out/share/licenses/onnxruntime/LICENSE"
      install -Dm644 ThirdPartyNotices.txt "$out/share/licenses/onnxruntime/ThirdPartyNotices.txt"
      substituteInPlace "$out/lib/pkgconfig/libonnxruntime.pc" \
        --replace-fail /usr/local "$out" \
        --replace-fail '/lib64' '/lib' \
        --replace-fail '/include/onnxruntime' '/include'
      substituteInPlace "$out/lib/cmake/onnxruntime/onnxruntimeTargets.cmake" \
        --replace-fail '/include/onnxruntime' '/include'
      substituteInPlace "$out/lib/cmake/onnxruntime/onnxruntimeTargets-release.cmake" \
        --replace-fail '/lib64/' '/lib/'
      runHook postInstall
    '';

    meta = {
      description = "Prebuilt ONNX Runtime with CUDA and TensorRT execution providers";
      homepage = "https://onnxruntime.ai";
      license = lib.licenses.mit;
      platforms = [ "x86_64-linux" ];
      sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    };
  };
in
stdenv.mkDerivation rec {
  pname = "obs-backgroundremoval";
  version = "1.3.7";

  src = fetchFromGitHub {
    owner = "royshil";
    repo = "obs-backgroundremoval";
    rev = version;
    hash = "sha256-bl0KixfBnBeyidZ4+RJhX4TDy33l9awo0wISMr7XUwk=";
  };

  nativeBuildInputs = [
    cmake
    ninja
    pkg-config
  ];

  buildInputs = [
    onnxruntimeWithTensorRT
    obs-studio
    qt6.qtbase
    curl.dev
    opencv
  ];

  # Never silently produce a CPU-only plugin if provider detection regresses.
  postConfigure = ''
    grep -q '^HAVE_ONNXRUNTIME_CUDA_EP:INTERNAL=1$' CMakeCache.txt
    grep -q '^HAVE_ONNXRUNTIME_TENSORRT_EP:INTERNAL=1$' CMakeCache.txt
  '';

  dontWrapQtApps = true;

  meta = {
    description = "OBS plugin to replace the background in portrait images and video";
    homepage = "https://github.com/royshil/obs-backgroundremoval";
    license = lib.licenses.mit;
    inherit (obs-studio.meta) platforms;
  };
}
