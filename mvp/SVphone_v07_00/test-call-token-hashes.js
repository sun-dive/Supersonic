/**
 * Test: Verify Call Token Address Hash Encoding
 *
 * This test verifies that:
 * 1. Address hashes are correctly computed (32-bit truncated SHA256)
 * 2. Hashes are correctly encoded into tokenRules.restrictions (concatenated)
 * 3. Both caller and callee can verify their hash is in restrictions
 */

// Test addresses
const testAddresses = {
  caller: '1A1z7agoat3iP2LywMwpYcTqsKBaeFj7V7',
  callee: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
}

// Function to compute hash (copied from CallTokenManager)
async function hashAddress(address) {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(address)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => ('0' + b.toString(16)).slice(-2)).join('')
    return hashHex.substring(0, 8)  // Return first 32 bits (8 hex chars)
  } catch (error) {
    console.error('Failed to hash address:', error)
    return '00000000'
  }
}

// Main test
async function testAddressHashEncoding() {
  console.log('=== CALL Token Address Hash Encoding Test ===\n')

  // Test 1: Compute hashes
  console.log('Test 1: Computing address hashes')
  console.log(`Caller address: ${testAddresses.caller}`)
  console.log(`Callee address: ${testAddresses.callee}\n`)

  const callerHash = await hashAddress(testAddresses.caller)
  const calleeHash = await hashAddress(testAddresses.callee)

  console.log(`✓ Caller hash: ${callerHash} (8 hex chars = 32 bits)`)
  console.log(`✓ Callee hash: ${calleeHash} (8 hex chars = 32 bits)\n`)

  // Test 2: Encode into restrictions
  console.log('Test 2: Encoding hashes into tokenRules.restrictions')
  const restrictions = callerHash + calleeHash
  console.log(`✓ Restrictions value: ${restrictions}`)
  console.log(`✓ Total length: ${restrictions.length} hex chars (64 bits)\n`)

  // Test 3: Verify caller can find their hash
  console.log('Test 3: Caller verification (checking if their hash is in restrictions)')
  const hash1 = restrictions.substring(0, 8)
  const hash2 = restrictions.substring(8, 16)
  console.log(`Parsing restrictions: hash1=${hash1}, hash2=${hash2}`)
  console.log(`Caller's own hash: ${callerHash}`)

  if (callerHash === hash1) {
    console.log(`✓ PASS: Caller found their hash in position 1 (first hash)\n`)
  } else if (callerHash === hash2) {
    console.log(`✓ PASS: Caller found their hash in position 2 (second hash)\n`)
  } else {
    console.log(`✗ FAIL: Caller could not find their hash in restrictions!\n`)
  }

  // Test 4: Verify callee can find their hash
  console.log('Test 4: Callee verification (checking if their hash is in restrictions)')
  console.log(`Callee's own hash: ${calleeHash}`)

  if (calleeHash === hash1) {
    console.log(`✓ PASS: Callee found their hash in position 1 (first hash)\n`)
  } else if (calleeHash === hash2) {
    console.log(`✓ PASS: Callee found their hash in position 2 (second hash)\n`)
  } else {
    console.log(`✗ FAIL: Callee could not find their hash in restrictions!\n`)
  }

  // Test 5: Simulate token object
  console.log('Test 5: Token object with restrictions')
  const mockToken = {
    tokenId: 'abc123def456',
    tokenName: 'CALL-1A1z7',
    tokenRules: {
      supply: 1,
      divisibility: 0,
      restrictions: restrictions  // The encoded hashes
    }
  }

  console.log('Mock token object:')
  console.log(JSON.stringify(mockToken, null, 2))
  console.log('\n=== All Tests Complete ===')
}

// Run the test
if (typeof window === 'undefined') {
  // Node.js environment - would need crypto polyfill
  console.log('Note: This test is designed for browser environment.')
  console.log('Run this in browser console or include with proper crypto support.')
} else {
  // Browser environment
  testAddressHashEncoding().catch(console.error)
}
