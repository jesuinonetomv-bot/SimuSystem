#!/usr/bin/env python3
"""Compile the dependency-free Android launcher using the official SDK tools."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

PROJECT = Path(__file__).resolve().parent
NS = "{http://schemas.android.com/apk/res/android}"


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Destination APK; unsigned unless signing is configured")
    args = parser.parse_args()
    sdk_value = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if not sdk_value:
        parser.error("Set ANDROID_SDK_ROOT to an Android SDK with platform 36 and build-tools 36.0.0.")
    sdk = Path(sdk_value).resolve()
    tools = sdk / "build-tools/36.0.0"
    android_jar = sdk / "platforms/android-36/android.jar"
    for file in [android_jar, tools / "aapt2", tools / "d8", tools / "zipalign", tools / "apksigner"]:
        if not file.is_file():
            parser.error(f"Missing SDK tool: {file}")
    manifest = ET.parse(PROJECT / "AndroidManifest.xml").getroot()
    version = manifest.get(NS + "versionName")
    build = PROJECT / "build"
    if build.exists():
        shutil.rmtree(build)
    for directory in ["generated", "classes", "dex", "test-classes"]:
        (build / directory).mkdir(parents=True, exist_ok=True)
    compiler = ["java", "-m", "jdk.compiler/com.sun.tools.javac.Main"]
    policy = PROJECT / "src/com/jesuino/simusystem/NavigationPolicy.java"
    test = PROJECT / "tests/com/jesuino/simusystem/NavigationPolicyTest.java"
    run(*compiler, "--release", "8", "-d", build / "test-classes", policy, test)
    run("java", "-cp", build / "test-classes", "com.jesuino.simusystem.NavigationPolicyTest")
    run(tools / "aapt2", "compile", "--dir", PROJECT / "res", "-o", build / "resources.zip")
    base = build / "base.apk"
    run(tools / "aapt2", "link", "-o", base, "-I", android_jar,
        "--manifest", PROJECT / "AndroidManifest.xml", "--java", build / "generated", build / "resources.zip")
    sources = sorted((PROJECT / "src").rglob("*.java")) + sorted((build / "generated").rglob("*.java"))
    run(*compiler, "--release", "8", "-classpath", android_jar, "-d", build / "classes", *sources)
    run(tools / "d8", "--release", "--min-api", "24", "--lib", android_jar,
        "--output", build / "dex", *sorted((build / "classes").rglob("*.class")))
    with zipfile.ZipFile(base, "a", compression=zipfile.ZIP_STORED) as apk:
        for dex in sorted((build / "dex").glob("*.dex")):
            apk.write(dex, dex.name)
    aligned = build / "aligned.apk"
    run(tools / "zipalign", "-P", "16", "-f", "4", base, aligned)
    keystore = os.environ.get("SIMUSYSTEM_KEYSTORE")
    output = (args.output or build / f"SimuSystem-v{version}-unsigned.apk").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if keystore:
        for name in ["SIMUSYSTEM_STORE_PASSWORD", "SIMUSYSTEM_KEY_PASSWORD"]:
            if not os.environ.get(name):
                parser.error(f"Set {name} to sign the APK.")
        run(tools / "apksigner", "sign", "--ks", keystore,
            "--ks-key-alias", os.environ.get("SIMUSYSTEM_KEY_ALIAS", "simusystem"),
            "--ks-pass", "env:SIMUSYSTEM_STORE_PASSWORD", "--key-pass", "env:SIMUSYSTEM_KEY_PASSWORD",
            "--out", output, aligned)
        run(tools / "apksigner", "verify", "--verbose", "--print-certs", output)
    else:
        shutil.copy2(aligned, output)
    run(tools / "zipalign", "-c", "-P", "16", "4", output)
    print(f"APK: {output}")


if __name__ == "__main__":
    main()
