<?php
// Afterglow HTTPS relay. No sessions, database, message files, analytics, or application request logging.
// Only opaque ciphertext is held briefly in shared RAM; consumed/expired packets are removed.
error_reporting(0);
ini_set('display_errors', '0');
ini_set('log_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['https://litebrite.it', 'https://www.litebrite.it', 'http://127.0.0.1:5183', 'https://white-oyster-665886.hostingersite.com', 'https://afterglow-litebrite.kenzokai.chatgpt.site', 'http://localhost:5183', 'http://localhost:5173'];
if ($origin !== '' && !in_array($origin, $allowed, true)) { http_response_code(403); echo '{"error":"origin"}'; exit; }
if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Max-Age: 600');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
function respond($data, $status = 200) { http_response_code($status); echo json_encode($data); exit; }
if (!function_exists('shmop_open')) respond(['error' => 'memory_unavailable'], 503);
// Namespace is specific to this app. OS permissions isolate this segment to the hosting account.
const MEMORY_KEY = 0x4a731be5;
const MEMORY_BYTES = 2097152;
umask(0077);
// This empty lock file contains no user data; it only serializes access between PHP workers.
$lock = @fopen(sys_get_temp_dir() . '/afterglow-relay-4a731be5.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX)) respond(['error' => 'memory_unavailable'], 503);
$memory = @shmop_open(MEMORY_KEY, 'c', 0600, MEMORY_BYTES);
if (!$memory) { flock($lock, LOCK_UN); fclose($lock); respond(['error' => 'memory_unavailable'], 503); }
$oldLength = unpack('N', shmop_read($memory, 0, 4))[1];
if ($oldLength >= MEMORY_BYTES - 4) $oldLength = 0;
$state = $oldLength > 0 && $oldLength < MEMORY_BYTES - 4 ? json_decode(shmop_read($memory, 4, $oldLength), true) : [];
if (!is_array($state)) $state = [];
$now = (int) round(microtime(true) * 1000);
foreach ($state as $key => &$room) {
  $room['retired'] = array_filter($room['retired'] ?? [], fn($expires) => $expires > $now);
  foreach ($room['members'] as $token => $member) {
    if ($now - $member['seen'] > 12000) unset($room['members'][$token]);
  }
  if (count($room['members']) !== 2) {
    $room['session'] = '';
    foreach ($room['members'] as &$member) { $member['inbox'] = []; } unset($member);
  }
  foreach ($room['members'] as &$member) {
    $member['inbox'] = array_values(array_filter($member['inbox'], fn($p) => $p['expires'] > $now));
  } unset($member);
  if (!$room['members'] && !$room['retired']) unset($state[$key]);
} unset($room);
$response = ['transport' => 'https-memory', 'ready' => true];
$status = 200;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $raw = file_get_contents('php://input', false, null, 0, 50001);
  $data = strlen($raw) <= 50000 ? json_decode($raw, true) : null;
  unset($raw);
  if (!is_array($data) || !is_string($data['room'] ?? null) || !is_string($data['token'] ?? null) || !is_string($data['id'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $data['room'] ?? '') || !preg_match('/^[a-f0-9]{64}$/D', $data['token'] ?? '') || !preg_match('/^[a-f0-9]{32}$/D', $data['id'] ?? '') || !in_array($data['action'] ?? '', ['poll', 'leave'], true)) {
    $status = 400; $response = ['error' => 'invalid_request'];
  } else {
    $key = $data['room']; $token = $data['token']; $id = $data['id'];
    if ($data['action'] === 'leave') {
      if (!isset($state[$key]) && count($state) < 16) $state[$key] = ['session' => '', 'members' => [], 'retired' => []];
      if (isset($state[$key])) {
        $state[$key]['retired'][$token] = $now + 15000;
        $state[$key]['retired'] = array_slice($state[$key]['retired'], -32, null, true);
      }
      if (isset($state[$key]['members'][$token])) {
        unset($state[$key]['members'][$token]); $state[$key]['session'] = '';
        foreach ($state[$key]['members'] as &$member) { $member['inbox'] = []; } unset($member);
        // Keep a short tombstone so an in-flight poll cannot reclaim the departed seat.
      }
      $response = ['state' => 'left'];
    } elseif (!isset($state[$key]) && count($state) >= 16) {
      $status = 503; $response = ['error' => 'busy'];
    } else {
      if (!isset($state[$key])) $state[$key] = ['session' => '', 'members' => [], 'retired' => []];
      $room = &$state[$key];
      if (isset($room['retired'][$token])) {
        $response = ['state' => 'left'];
      } elseif (!isset($room['members'][$token]) && count($room['members']) >= 2) {
        $response = ['state' => 'full'];
      } else {
        if (!isset($room['members'][$token])) {
          if (in_array($id, array_column($room['members'], 'id'), true)) {
            flock($lock, LOCK_UN); fclose($lock); respond(['error' => 'identity'], 403);
          }
          $room['members'][$token] = ['id' => $id, 'seen' => $now, 'inbox' => [], 'window' => $now, 'requests' => 0];
          $room['session'] = count($room['members']) === 2 ? bin2hex(random_bytes(16)) : '';
          foreach ($room['members'] as &$member) { $member['inbox'] = []; } unset($member);
        }
        $me = &$room['members'][$token];
        if ($me['id'] !== $id) { $status = 403; $response = ['error' => 'identity']; }
        else {
          if ($now - $me['window'] > 1000) { $me['window'] = $now; $me['requests'] = 0; }
          $me['requests']++;
          $me['seen'] = $now;
          if ($me['requests'] > 12) { $status = 429; $response = ['error' => 'rate_limited']; }
          else {
            $partner = null;
            foreach ($room['members'] as $otherToken => $other) if ($otherToken !== $token) $partner = $other['id'];
            // Deliver once. Never replay old-session data to a new or returning participant.
            $incoming = $me['inbox']; $me['inbox'] = [];
            $sessionMatches = $room['session'] !== '' && ($data['session'] ?? '') === $room['session'];
            if ($sessionMatches && is_array($data['packets'] ?? null)) {
              foreach (array_slice($data['packets'], 0, 8) as $packet) {
                if (!is_string($packet) || strlen($packet) > 5000 || !preg_match('/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,4983}$/D', $packet)) continue;
                foreach ($room['members'] as $otherToken => &$other) if ($otherToken !== $token) {
                  $other['inbox'][] = ['ciphertext' => $packet, 'expires' => $now + 800];
                  $other['inbox'] = array_slice($other['inbox'], -8);
                } unset($other);
              }
            }
            $response = ['state' => $partner ? 'connected' : 'waiting', 'partner' => $partner, 'session' => $room['session'], 'now' => $now, 'packets' => $sessionMatches ? array_column($incoming, 'ciphertext') : []];
          }
        }
        unset($me);
      }
      unset($room);
    }
  }
} elseif ($_SERVER['REQUEST_METHOD'] !== 'GET') { $status = 405; $response = ['error' => 'method']; }
$json = json_encode($state);
$length = strlen($json);
if ($length >= MEMORY_BYTES - 4) { $json = '[]'; $length = 2; $status = 503; $response = ['error' => 'busy']; }
shmop_write($memory, pack('N', $length) . $json . str_repeat("\0", max(0, $oldLength - $length)), 0);
unset($state, $json, $memory, $data, $incoming);
flock($lock, LOCK_UN); fclose($lock);
respond($response, $status);
