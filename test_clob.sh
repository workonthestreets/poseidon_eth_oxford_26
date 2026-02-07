#!/bin/bash

# Test script for Rust CLOB
BASE_URL="http://localhost:8080"

echo "=== Testing Maritime CLOB ==="
echo

# 1. List markets
echo "1. Listing markets..."
MARKETS=$(curl -s "$BASE_URL/api/markets")
echo "$MARKETS" | head -c 500
echo
echo

# Get first market ID
MARKET_ID=$(echo "$MARKETS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Using market ID: $MARKET_ID"
echo

# 2. Deposit funds for test users
echo "2. Depositing funds..."
curl -s -X POST "$BASE_URL/api/users/alice/deposit" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
echo

curl -s -X POST "$BASE_URL/api/users/bob/deposit" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
echo
echo

# 3. Check balances
echo "3. Checking balances..."
echo "Alice:" $(curl -s "$BASE_URL/api/users/alice/balance")
echo "Bob:" $(curl -s "$BASE_URL/api/users/bob/balance")
echo

# 4. Get orderbook before trades
echo "4. Orderbook before our trades..."
curl -s "$BASE_URL/api/markets/$MARKET_ID" | grep -A 20 '"yes_bids"'
echo

# 5. Alice places YES bid @ 40 cents
echo "5. Alice buys YES @ 40 cents (100 shares)..."
ALICE_ORDER=$(curl -s -X POST "$BASE_URL/api/orders" \
  -H "Content-Type: application/json" \
  -d "{
    \"market_id\": \"$MARKET_ID\",
    \"user_id\": \"alice\",
    \"side\": \"Yes\",
    \"order_type\": \"Limit\",
    \"price\": 40,
    \"quantity\": 100
  }")
echo "$ALICE_ORDER" | head -c 300
echo
echo

# 6. Bob places NO bid @ 60 cents (should match with Alice!)
echo "6. Bob buys NO @ 60 cents (100 shares)..."
echo "   (40 + 60 = 100, should MATCH!)"
BOB_ORDER=$(curl -s -X POST "$BASE_URL/api/orders" \
  -H "Content-Type: application/json" \
  -d "{
    \"market_id\": \"$MARKET_ID\",
    \"user_id\": \"bob\",
    \"side\": \"No\",
    \"order_type\": \"Limit\",
    \"price\": 60,
    \"quantity\": 100
  }")
echo "$BOB_ORDER" | head -c 500
echo
echo

# 7. Check if trade occurred
echo "7. Checking trades..."
if echo "$BOB_ORDER" | grep -q '"trades":\[\]'; then
  echo "   NO TRADES - orders didn't match"
else
  echo "   TRADE EXECUTED!"
fi
echo

# 8. Check positions
echo "8. Checking positions..."
echo "Alice positions:" $(curl -s "$BASE_URL/api/users/alice/positions")
echo "Bob positions:" $(curl -s "$BASE_URL/api/users/bob/positions")
echo

# 9. Check final balances
echo "9. Final balances..."
echo "Alice:" $(curl -s "$BASE_URL/api/users/alice/balance")
echo "Bob:" $(curl -s "$BASE_URL/api/users/bob/balance")
echo

echo "=== Test Complete ==="
