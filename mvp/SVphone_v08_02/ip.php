<?php
/**
 * SVphone public IP detection endpoint
 *
 * Deploy at:
 *   svphone.com/ip.php          — returns client IP (IPv4 or IPv6)
 *   ip4.svphone.com/ip.php      — A record only → always returns IPv4
 *   ip6.svphone.com/ip.php      — AAAA record only → always returns IPv6
 */
header('Access-Control-Allow-Origin: *');
header('Content-Type: text/plain');

$ip = $_SERVER['REMOTE_ADDR'] ?? '';

// Unwrap IPv6-mapped IPv4 addresses (::ffff:x.x.x.x → x.x.x.x)
if (strncmp($ip, '::ffff:', 7) === 0) {
    $ip = substr($ip, 7);
}

echo $ip;
