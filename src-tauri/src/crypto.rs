use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    getrandom::fill(&mut buffer).expect("secure random generator unavailable");
    hex(&buffer)
}

pub fn fingerprint_from_public_key(public_key: &str) -> Result<String, String> {
    let bytes = hex32(public_key)?;
    let digest = Sha256::digest(bytes);
    Ok(hex(&digest[..8]))
}

pub fn pairing_code(
    local_device_id: &str,
    remote_device_id: &str,
    local_nonce: &str,
    remote_nonce: &str,
    local_dh_public_key: &str,
    remote_dh_public_key: &str,
) -> String {
    let (first_device, second_device) = sorted_pair(local_device_id, remote_device_id);
    let (first_nonce, second_nonce) = sorted_pair(local_nonce, remote_nonce);
    let (first_public_key, second_public_key) =
        sorted_pair(local_dh_public_key, remote_dh_public_key);
    let mut hasher = Sha256::new();
    hasher.update(first_device.as_bytes());
    hasher.update(second_device.as_bytes());
    hasher.update(first_nonce.as_bytes());
    hasher.update(second_nonce.as_bytes());
    hasher.update(first_public_key.as_bytes());
    hasher.update(second_public_key.as_bytes());
    let digest = hasher.finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

pub fn pairing_shared_secret(
    local_device_id: &str,
    remote_device_id: &str,
    local_nonce: &str,
    remote_nonce: &str,
    local_dh_public_key: &str,
    remote_dh_public_key: &str,
    dh_shared_secret: &str,
) -> String {
    let (first_device, second_device) = sorted_pair(local_device_id, remote_device_id);
    let (first_nonce, second_nonce) = sorted_pair(local_nonce, remote_nonce);
    let (first_public_key, second_public_key) =
        sorted_pair(local_dh_public_key, remote_dh_public_key);
    let mut hasher = Sha256::new();
    hasher.update(b"remoteshare-pairing-secret-v2");
    hasher.update(dh_shared_secret.as_bytes());
    hasher.update(first_device.as_bytes());
    hasher.update(second_device.as_bytes());
    hasher.update(first_nonce.as_bytes());
    hasher.update(second_nonce.as_bytes());
    hasher.update(first_public_key.as_bytes());
    hasher.update(second_public_key.as_bytes());
    hex(&hasher.finalize())
}

pub fn x25519_keypair() -> (String, String) {
    let mut private_key = [0_u8; 32];
    getrandom::fill(&mut private_key).expect("secure random generator unavailable");
    let secret = StaticSecret::from(private_key);
    let public = PublicKey::from(&secret);
    (hex(&private_key), hex(public.as_bytes()))
}

pub fn identity_keypair() -> (String, String) {
    x25519_keypair()
}

pub fn x25519_shared_secret(
    local_private_key: &str,
    remote_public_key: &str,
) -> Result<String, String> {
    let local_private = hex32(local_private_key)?;
    let remote_public = hex32(remote_public_key)?;
    let secret = StaticSecret::from(local_private);
    let public = PublicKey::from(remote_public);
    Ok(hex(secret.diffie_hellman(&public).as_bytes()))
}

pub fn x25519_public_key_is_well_formed(public_key: &str) -> bool {
    hex32(public_key).is_ok()
}

pub fn control_mac(shared_secret: &str, nonce: &str, message_payload: &[u8]) -> String {
    let mut payload = Vec::with_capacity(
        b"remoteshare-control-mac-v1".len() + nonce.len() + message_payload.len(),
    );
    payload.extend_from_slice(b"remoteshare-control-mac-v1");
    payload.extend_from_slice(nonce.as_bytes());
    payload.extend_from_slice(message_payload);
    hmac_sha256_hex(shared_secret.as_bytes(), &payload)
}

pub fn encrypt_control_payload(
    shared_secret: &str,
    payload: &[u8],
) -> Result<(String, String), String> {
    let key = control_encryption_key(shared_secret);
    let cipher = XChaCha20Poly1305::new((&key).into());
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce)
        .map_err(|error| format!("secure random generator failed: {error}"))?;
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), payload)
        .map_err(|_| "control message encryption failed".to_string())?;
    Ok((hex(&nonce), hex(&ciphertext)))
}

pub fn decrypt_control_payload(
    shared_secret: &str,
    nonce: &str,
    ciphertext: &str,
) -> Result<Vec<u8>, String> {
    let key = control_encryption_key(shared_secret);
    let cipher = XChaCha20Poly1305::new((&key).into());
    let nonce = hex24(nonce)?;
    let ciphertext = hex_bytes(ciphertext)?;
    cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_slice())
        .map_err(|_| "control message decryption failed".to_string())
}

fn control_encryption_key(shared_secret: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"remoteshare-control-aead-v1");
    hasher.update(shared_secret.as_bytes());
    hasher.finalize().into()
}

fn sorted_pair<'a>(first: &'a str, second: &'a str) -> (&'a str, &'a str) {
    if first <= second {
        (first, second)
    } else {
        (second, first)
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex32(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 {
        return Err("X25519 key must be 32 bytes encoded as hex.".to_string());
    }
    let mut output = [0_u8; 32];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let text = std::str::from_utf8(chunk).map_err(|_| "X25519 key is not valid UTF-8.")?;
        output[index] =
            u8::from_str_radix(text, 16).map_err(|_| "X25519 key is not valid hex.".to_string())?;
    }
    Ok(output)
}

fn hex24(value: &str) -> Result<[u8; 24], String> {
    if value.len() != 48 {
        return Err("nonce must be 24 bytes encoded as hex.".to_string());
    }
    let bytes = hex_bytes(value)?;
    bytes
        .try_into()
        .map_err(|_| "nonce must be 24 bytes encoded as hex.".to_string())
}

fn hex_bytes(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 {
        return Err("hex value must have an even length.".to_string());
    }
    let mut output = Vec::with_capacity(value.len() / 2);
    for chunk in value.as_bytes().chunks_exact(2) {
        let text = std::str::from_utf8(chunk).map_err(|_| "hex value is not valid UTF-8.")?;
        output.push(
            u8::from_str_radix(text, 16).map_err(|_| "hex value is not valid hex.".to_string())?,
        );
    }
    Ok(output)
}

fn hmac_sha256_hex(key: &[u8], payload: &[u8]) -> String {
    const BLOCK_SIZE: usize = 64;

    let mut normalized_key = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let digest = Sha256::digest(key);
        normalized_key[..digest.len()].copy_from_slice(&digest);
    } else {
        normalized_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= normalized_key[index];
        outer_pad[index] ^= normalized_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(payload);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    hex(&outer.finalize())
}

#[cfg(test)]
mod tests {
    use super::{
        decrypt_control_payload, encrypt_control_payload, fingerprint_from_public_key,
        hmac_sha256_hex, pairing_code, x25519_keypair, x25519_public_key_is_well_formed,
        x25519_shared_secret,
    };

    #[test]
    fn pairing_code_is_independent_of_local_remote_order() {
        let first = pairing_code(
            "device-a", "device-b", "nonce-a", "nonce-b", "key-a", "key-b",
        );
        let second = pairing_code(
            "device-b", "device-a", "nonce-b", "nonce-a", "key-b", "key-a",
        );

        assert_eq!(first, second);
        assert_eq!(first.len(), 6);
    }

    #[test]
    fn pairing_code_changes_when_nonce_changes() {
        let first = pairing_code(
            "device-a", "device-b", "nonce-a", "nonce-b", "key-a", "key-b",
        );
        let second = pairing_code(
            "device-a", "device-b", "nonce-a", "nonce-c", "key-a", "key-b",
        );

        assert_ne!(first, second);
    }

    #[test]
    fn x25519_shared_secret_matches_on_both_sides() {
        let (first_private, first_public) = x25519_keypair();
        let (second_private, second_public) = x25519_keypair();

        let first = x25519_shared_secret(&first_private, &second_public).unwrap();
        let second = x25519_shared_secret(&second_private, &first_public).unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn x25519_public_key_well_formed_requires_32_byte_hex() {
        let (_private_key, public_key) = x25519_keypair();

        assert!(x25519_public_key_is_well_formed(&public_key));
        assert!(!x25519_public_key_is_well_formed(""));
        assert!(!x25519_public_key_is_well_formed("not-hex"));
        assert!(!x25519_public_key_is_well_formed("00"));
    }

    #[test]
    fn fingerprint_is_derived_from_public_key_bytes() {
        let (_private_key, public_key) = x25519_keypair();

        assert_eq!(
            fingerprint_from_public_key(&public_key).unwrap(),
            fingerprint_from_public_key(&public_key).unwrap()
        );
        assert!(fingerprint_from_public_key("not-hex").is_err());
    }

    #[test]
    fn hmac_sha256_matches_known_vector() {
        let key = [0x0b_u8; 20];
        assert_eq!(
            hmac_sha256_hex(&key, b"Hi There"),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn control_payload_encryption_round_trips_and_rejects_wrong_secret() {
        let payload = br#"{"type":"input-event","value":"secret"}"#;
        let (nonce, ciphertext) = encrypt_control_payload("shared-secret", payload).unwrap();

        assert_ne!(ciphertext, String::from_utf8_lossy(payload));
        assert_eq!(
            decrypt_control_payload("shared-secret", &nonce, &ciphertext).unwrap(),
            payload
        );
        assert!(decrypt_control_payload("wrong-secret", &nonce, &ciphertext).is_err());
    }
}
