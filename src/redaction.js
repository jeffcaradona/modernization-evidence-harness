export function createRedactor({ secrets = [], patterns = [] } = {}) {
  const normalizedSecrets = secrets.filter(Boolean);
  const fieldPatterns = patterns.length
    ? patterns
    : [
        /(password\s*[=:]\s*)([^\s;]+)/gi,
        /(token\s*[=:]\s*)([^\s;]+)/gi,
        /(authorization\s*:\s*)([^\s;]+)/gi,
        /(user\s+id=)([^;\s]+)/gi,
      ];

  return {
    redact(input) {
      let output = String(input ?? '');
      for (const secret of normalizedSecrets) {
        output = output.split(secret).join('[REDACTED_SECRET]');
      }
      for (const pattern of fieldPatterns) {
        output = output.replace(pattern, '$1[REDACTED_FIELD]');
      }
      return output;
    },
    describe() {
      return {
        explicitSecrets: normalizedSecrets.length,
        patternCount: fieldPatterns.length,
        note: 'Pattern redaction reduces exposure but cannot prove that every secret-shaped value was removed.',
      };
    },
  };
}
