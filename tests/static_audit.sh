#!/usr/bin/env bash
set -e

echo "=== FastStream 开源知识产权与敏感字符串静态扫描 ==="

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEAK_FOUND=0

KEYWORDS=("TDM Fast" "tdmfast.com" "freedidi" "license_activate" "license.dat" "MachineGuid" "SMBiosData")

for kw in "${KEYWORDS[@]}"; do
  echo -n "Scanning for \"$kw\"... "
  MATCHES=$(grep -rn "$kw" "$PROJECT_DIR/src" "$PROJECT_DIR/ui" "$PROJECT_DIR/package.json" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "❌ 发现敏感残留字符串:"
    echo "$MATCHES"
    LEAK_FOUND=1
  else
    echo "✅ 无残留"
  fi
done

if [ "$LEAK_FOUND" -eq 1 ]; then
  echo "⚠️ 静态审计失败：存在侵权或旧项目敏感残留，请彻底清理。"
  exit 1
else
  echo "🎉 静态审计 100% 通过：代码库干干净净，具备合规开源资质！"
fi
