use candle_core::{Device, Tensor};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Testing Candle...");

    let device = Device::Cpu;
    let tensor = Tensor::randn(0.0f32, 1.0, (2, 3), &device)?;

    println!("Created tensor: {:?}", tensor);
    println!("Candle works!");

    Ok(())
}
