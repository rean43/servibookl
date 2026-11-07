<?php
require_once 'db.php';

function isLoggedIn() {
    return isset($_SESSION['user_id']);
}

function getUserRole() {
    return $_SESSION['role'] ?? null;
}

function requireLogin() {
    if (!isLoggedIn()) {
        header('Location: login.php');
        exit;
    }
}

function requireRole($role) {
    requireLogin();
    if (getUserRole() !== $role) {
        header('Location: index.php');
        exit;
    }
}

function getCurrentUser() {
    if (!isLoggedIn()) return null;

    global $pdo;
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    return $stmt->fetch();
}
?>
<?php
function getCategories() {
    global $pdo;
    $stmt = $pdo->query("SELECT * FROM categories WHERE status = 'active' ORDER BY name");
    return $stmt->fetchAll();
}

