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
        println!("cargo:rustc-link-lib=static=native_overlay");
        
        // Link required macOS frameworks
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=WebKit");
        
        // Link Swift runtime
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        println!("cargo:rustc-link-lib=dylib=swiftCore");
        println!("cargo:rustc-link-lib=dylib=swiftFoundation");
        
        // Compile app context detector
        println!("cargo:rerun-if-changed=src/macos/active_app_detector.swift");
        println!("cargo:rerun-if-changed=src/macos/app_context_bridge.m");
        
        let app_context_swift_obj = out_dir.join("active_app_detector.o");
        let app_context_bridge_obj = out_dir.join("app_context_bridge.o");
        let app_context_lib = out_dir.join("libapp_context.a");
        
        // Compile Swift active app detector
        let output = std::process::Command::new("swiftc")
            .args(&[
                "-c",
                "-emit-objc-header",
                "-emit-objc-header-path", out_dir.join("app_context-Swift.h").to_str().unwrap(),
                "-module-name", "app_context",
                "-o", app_context_swift_obj.to_str().unwrap(),
                "src/macos/active_app_detector.swift"
            ])
            .output()
            .expect("Failed to execute Swift compiler for app context");
        
        if !output.status.success() {
            println!("cargo:warning=App context Swift compilation failed");
            println!("cargo:warning=stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&output.stderr));
            panic!("Failed to compile app context Swift code");
        }
        
        // Compile Objective-C bridge for app context
        let output = std::process::Command::new("clang")
            .args(&[
                "-c",
                "-fobjc-arc",
                "-I", out_dir.to_str().unwrap(),
                "-o", app_context_bridge_obj.to_str().unwrap(),
                "src/macos/app_context_bridge.m"
            ])
            .output()
            .expect("Failed to compile app context bridge");
        
        if !output.status.success() {
            println!("cargo:warning=App context bridge compilation failed");
            println!("cargo:warning=stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&output.stderr));
            panic!("Failed to compile app context bridge");
        }
        
        // Create static library for app context
        let _ = std::fs::remove_file(&app_context_lib);
        let ar_output = std::process::Command::new("ar")
            .args(&[
                "rcs",
                app_context_lib.to_str().unwrap(),
                app_context_swift_obj.to_str().unwrap(),
                app_context_bridge_obj.to_str().unwrap()
            ])
            .output()
            .expect("Failed to create app context static library");
        
        if !ar_output.status.success() {
            println!("cargo:warning=Failed to create app context static library");
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&ar_output.stderr));
            panic!("Failed to create app context static library");
        }
        
        // Link the app context library
        println!("cargo:rustc-link-lib=static=app_context");
        
        // Compile Native NSPanel overlay
        println!("cargo:rerun-if-changed=src/macos/native_overlay/Logger.swift");
        println!("cargo:rerun-if-changed=src/macos/native_overlay/NativeOverlayPanel.swift");
        println!("cargo:rerun-if-changed=src/macos/native_overlay/OverlayViewController.swift");
        println!("cargo:rerun-if-changed=src/macos/native_overlay/OverlayBridge.swift");
        
        let native_overlay_lib_path = out_dir.join("libnative_overlay.a");
        
        // Change directory to the output directory for compilation
        std::env::set_current_dir(&out_dir).expect("Failed to change directory");
        
        // Compile all native overlay Swift files together without specifying output
        let output = std::process::Command::new("swiftc")
            .args(&[
                "-c",
                "-module-name", "NativeOverlay",
                &format!("{}/src/macos/native_overlay/Logger.swift", env!("CARGO_MANIFEST_DIR")),
                &format!("{}/src/macos/native_overlay/NativeOverlayPanel.swift", env!("CARGO_MANIFEST_DIR")),
                &format!("{}/src/macos/native_overlay/OverlayViewController.swift", env!("CARGO_MANIFEST_DIR")),
                &format!("{}/src/macos/native_overlay/OverlayBridge.swift", env!("CARGO_MANIFEST_DIR"))
            ])
            .output()
            .expect("Failed to execute Swift compiler for native overlay");
        
        if !output.status.success() {
            println!("cargo:warning=Native overlay Swift compilation failed");
            println!("cargo:warning=stdout: {}", String::from_utf8_lossy(&output.stdout));
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&output.stderr));
            panic!("Failed to compile native overlay Swift code");
        }
        
        // Change back to the original directory
        std::env::set_current_dir(env!("CARGO_MANIFEST_DIR")).expect("Failed to change directory back");
        
        // Find all .o files created by the compiler
        let object_files: Vec<_> = std::fs::read_dir(&out_dir)
            .expect("Failed to read output directory")
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let path = entry.path();
                if path.extension()?.to_str()? == "o" && 
                   (path.file_name()?.to_str()?.contains("NativeOverlay") ||
                    path.file_name()?.to_str()?.contains("Overlay") ||
                    path.file_name()?.to_str()?.contains("Logger")) {
                    println!("cargo:warning=Found object file: {}", path.display());
                    Some(path)
                } else {
                    None
                }
            })
            .collect();
            
        if object_files.is_empty() {
            panic!("No object files found for native overlay!");
        }
        
        // Create static library from all object files
        let mut ar_args = vec!["rcs", native_overlay_lib_path.to_str().unwrap()];
        for obj_file in &object_files {
            ar_args.push(obj_file.to_str().unwrap());
        }
        
        let ar_output = std::process::Command::new("ar")
            .args(&ar_args)
            .output()
            .expect("Failed to create native overlay static library");
        
        if !ar_output.status.success() {
            println!("cargo:warning=Failed to create native overlay static library");
            println!("cargo:warning=stderr: {}", String::from_utf8_lossy(&ar_output.stderr));
            panic!("Failed to create native overlay static library");
        }
        
        // Link the native overlay library
        println!("cargo:rustc-link-lib=static=native_overlay");
    }
    
    tauri_build::build()
}
// Force rebuild at: 2025-06-16 13:57:00
