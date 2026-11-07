<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php'; // Starts the shared PHP session.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function decodeBase64Url(string $value): string|false
{
    $value = strtr($value, '-_', '+/');
    return base64_decode($value . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
}

function verifyFirebaseIdToken(string $token, string $projectId): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        throw new RuntimeException('Invalid ID token.');
    }

    $headerJson = decodeBase64Url($parts[0]);
    $claimsJson = decodeBase64Url($parts[1]);
    $signature = decodeBase64Url($parts[2]);
    $header = is_string($headerJson) ? json_decode($headerJson, true) : null;
    $claims = is_string($claimsJson) ? json_decode($claimsJson, true) : null;
    if (!is_array($header) || !is_array($claims) || !is_string($signature) || ($header['alg'] ?? '') !== 'RS256') {
        throw new RuntimeException('Invalid ID token.');
    }

    // Fetch Firebase's published signing certificates over TLS. Cache for the
    // shorter of their max-age or one hour so key rotation is respected.
    $certUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
    $certs = false;
    $cacheFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'servibook-firebase-certs.json';
    if (is_file($cacheFile) && filemtime($cacheFile) > time() - 3600) {
        $certs = json_decode((string) file_get_contents($cacheFile), true);
    }
    if (!is_array($certs)) {
        $context = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => false]]);
        $certJson = @file_get_contents($certUrl, false, $context);
        if (!is_string($certJson)) {
            throw new RuntimeException('Unable to verify Firebase token signing key.');
        }
        $certs = json_decode($certJson, true);
        if (!is_array($certs)) {
            throw new RuntimeException('Unable to read Firebase token signing keys.');
        }
        @file_put_contents($cacheFile, $certJson, LOCK_EX);
    }

    $keyId = $header['kid'] ?? '';
    if (!is_string($keyId) || !isset($certs[$keyId])) {
        // Refresh the key set once in case Firebase rotated its signing keys.
        @unlink($cacheFile);
        $context = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => false]]);
        $certJson = @file_get_contents($certUrl, false, $context);
        $refreshedCerts = is_string($certJson) ? json_decode($certJson, true) : null;
        if (is_array($refreshedCerts)) {
            $certs = $refreshedCerts;
            @file_put_contents($cacheFile, $certJson, LOCK_EX);
        }
        if (!is_string($keyId) || !isset($certs[$keyId])) {
            throw new RuntimeException('Firebase token signing key is unavailable.');
        }
    }

    $publicKey = openssl_pkey_get_public($certs[$keyId]);
    if ($publicKey === false || openssl_verify($parts[0] . '.' . $parts[1], $signature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
        throw new RuntimeException('Firebase ID token signature is invalid.');
    }

    $now = time();
    if (($claims['aud'] ?? null) !== $projectId
        || ($claims['iss'] ?? null) !== 'https://securetoken.google.com/' . $projectId
        || !is_string($claims['sub'] ?? null)
        || $claims['sub'] === ''
        || strlen($claims['sub']) > 128
        || !isset($claims['iat'], $claims['exp'], $claims['auth_time'])
        || !is_numeric($claims['iat']) || !is_numeric($claims['exp']) || !is_numeric($claims['auth_time'])
        || (int) $claims['iat'] > $now + 60
        || (int) $claims['auth_time'] > $now + 60
        || (int) $claims['exp'] <= $now) {
        throw new RuntimeException('Firebase ID token claims are invalid or expired.');
    }

    return $claims;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond(405, ['error' => 'POST is required.']);
}

$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = $_POST;
}

if (($input['action'] ?? '') === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $cookie = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $cookie['path'], $cookie['domain'], $cookie['secure'], $cookie['httponly']);
    }
    session_destroy();
    respond(200, ['ok' => true]);
}

$projectId = getenv('FIREBASE_PROJECT_ID') ?: '';
$idToken = $input['idToken'] ?? '';
if ($projectId === '' || !is_string($idToken) || $idToken === '') {
    respond(400, ['error' => 'Firebase project configuration or ID token is missing.']);
}

try {
    $claims = verifyFirebaseIdToken($idToken, $projectId);
    // Never trust a client-supplied UID or email. Only signed, verified claims
    // from Firebase establish this PHP session.
    session_regenerate_id(true);
    // Keep legacy numeric IDs when an existing MySQL account matches the
    // verified Firebase email. New Firebase-only accounts use their UID.
    $legacyUser = null;
    if (is_string($claims['email'] ?? null) && $claims['email'] !== '') {
        $stmt = $pdo->prepare('SELECT id, full_name, email, role FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$claims['email']]);
        $legacyUser = $stmt->fetch();
    }
    $_SESSION['user_id'] = $legacyUser ? (int) $legacyUser['id'] : $claims['sub'];
    $_SESSION['firebase_uid'] = $claims['sub'];
    $_SESSION['email'] = is_string($claims['email'] ?? null) ? $claims['email'] : null;
    if ($legacyUser) {
        $_SESSION['full_name'] = $legacyUser['full_name'];
        $_SESSION['role'] = $legacyUser['role'];
    }
    $_SESSION['logged_in'] = true;
    respond(200, ['ok' => true, 'uid' => $claims['sub']]);
} catch (Throwable $error) {
    error_log('Firebase session sync failed: ' . $error->getMessage());
    respond(401, ['error' => 'Firebase authentication could not be verified.']);
}
