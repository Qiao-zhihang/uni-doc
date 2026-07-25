use std::fs;
use std::path::PathBuf;

fn main() {
  let pkg_json: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "package.json"]
    .iter()
    .collect();

  let version = fs::read_to_string(&pkg_json)
    .ok()
    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    .and_then(|v| v.get("version")?.as_str()?.to_string().into())
    .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

  std::env::set_var("TAURI_VERSION", &version);
  println!("cargo:rerun-if-changed=../package.json");
  tauri_build::build()
}
