use std::env;
use std::path::PathBuf;

fn main() {
    // Only compile macOS specific code on macOS
    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "macos" {
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        
        // Create output paths
        let swift_obj_path = out_dir.join("overlay.o");
        let bridge_obj_path = out_dir.join("overlay_bridge.o");
        let combined_lib_path = out_dir.join("libmacos_overlay.a");
        let swift_header_path = out_dir.join("overlay-Swift.h");
        
        // Compile Swift to object file
        let output = std::process::Command::new("swiftc")
            .args(&[
                "-c",
                "-emit-objc-header",
                "-emit-objc-header-path", swift_header_path.to_str().unwrap(),
                "-module-name", "overlay",
                "-import-objc-header", "src/macos/BridgingHeader.h",
                "-o", swift_obj_path.to_str().unwrap(),
                "src/macos/overlay.swift"
            ])
            .output()
            .expect("Failed to execute Swift compiler");
        
        if !output.status.success() {
            println!("cargo:warning=Swift compilation failed");
            println!("cargo:warning=stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&output.stderr));
            panic!("Failed to compile Swift code");
        }
        
        // Compile Objective-C bridge
        let output = std::process::Command::new("clang")
            .args(&[
                "-c",
                "-fobjc-arc",
                "-I", out_dir.to_str().unwrap(),
                "-o", bridge_obj_path.to_str().unwrap(),
                "src/macos/overlay_bridge.m"
            ])
            .output()
            .expect("Failed to compile Objective-C bridge");
        
        if !output.status.success() {
            println!("cargo:warning=Objective-C compilation failed");
            println!("cargo:warning=stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&output.stderr));
            panic!("Failed to compile Objective-C code");
        }
        
        // Remove existing library if it exists
        let _ = std::fs::remove_file(&combined_lib_path);
        
        // Create static library from both object files
        let ar_output = std::process::Command::new("ar")
            .args(&[
                "rcs",
                combined_lib_path.to_str().unwrap(),
                swift_obj_path.to_str().unwrap(),
                bridge_obj_path.to_str().unwrap()
            ])
            .output()
            .expect("Failed to create static library");
        
        if !ar_output.status.success() {
            println!("cargo:warning=Failed to create static library");
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&ar_output.stderr));
            panic!("Failed to create static library");
        }
        
        // Link the combined library
        println!("cargo:rustc-link-search=native={}", out_dir.display());
        println!("cargo:rustc-link-lib=static=macos_overlay");
        
        // Link required macOS frameworks
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=WebKit");
        
        // Link Swift runtime
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        println!("cargo:rustc-link-lib=dylib=swiftCore");
        println!("cargo:rustc-link-lib=dylib=swiftFoundation");
    }
    
    tauri_build::build()
}
