/**
 * Autonomous Submission Engine
 * Decides when to submit applications without user confirmation
 * based on confidence scores and completeness metrics
 */

export class AutoSubmitEngine {
  constructor() {
    // Thresholds for auto-submission
    this.confidenceThreshold = 0.85; // 85% average confidence
    this.fillRateThreshold = 0.95;    // 95% of required fields
    this.minFieldsThreshold = 5;      // At least 5 fields filled
  }

  /**
   * Main decision function: Should we auto-submit?
   */
  async shouldAutoSubmit(applicationState) {
    const {
      filledCount = 0,
      totalRequiredFields = 0,
      skippedFields = [],
      resumeAttached = false,
      fieldConfidences = [],
      platform = 'unknown',
      userPreferences = {},
      jobUrl = '',
    } = applicationState;

    // Pre-checks: Must-have conditions
    const preChecks = this.runPreChecks({
      resumeAttached,
      filledCount,
      totalRequiredFields,
      userPreferences
    });

    if (!preChecks.passed) {
      return {
        shouldSubmit: false,
        reason: preChecks.reason,
        requiresConfirmation: true,
        confidence: 0,
        metrics: this.buildMetrics(applicationState)
      };
    }

    // Calculate metrics
    const fillRate = totalRequiredFields > 0 
      ? filledCount / totalRequiredFields 
      : 0;

    const avgConfidence = fieldConfidences.length > 0
      ? fieldConfidences.reduce((sum, c) => sum + c, 0) / fieldConfidences.length
      : 0;

    // Check critical fields
    const criticalFieldsCheck = this.checkCriticalFields(skippedFields);
    
    // Platform trust score
    const platformTrusted = this.isPlatformTrusted(platform);

    // Decision matrix
    const checks = {
      fillRate: {
        passed: fillRate >= this.fillRateThreshold,
        value: fillRate,
        threshold: this.fillRateThreshold,
        weight: 0.3
      },
      confidence: {
        passed: avgConfidence >= this.confidenceThreshold,
        value: avgConfidence,
        threshold: this.confidenceThreshold,
        weight: 0.4
      },
      criticalFields: {
        passed: criticalFieldsCheck.allPresent,
        value: criticalFieldsCheck.presentCount,
        threshold: criticalFieldsCheck.requiredCount,
        weight: 0.2
      },
      platform: {
        passed: platformTrusted,
        value: platformTrusted ? 1 : 0,
        threshold: 1,
        weight: 0.1
      }
    };

    // Calculate weighted score
    const weightedScore = Object.values(checks).reduce((sum, check) => {
      return sum + (check.passed ? check.weight : 0);
    }, 0);

    // All critical checks must pass
    const allChecksPassed = checks.fillRate.passed && 
                           checks.confidence.passed && 
                           checks.criticalFields.passed;

    const shouldSubmit = allChecksPassed && weightedScore >= 0.9;

    if (shouldSubmit) {
      return {
        shouldSubmit: true,
        reason: 'All quality checks passed - safe to auto-submit',
        requiresConfirmation: false,
        confidence: avgConfidence,
        weightedScore,
        checks,
        metrics: this.buildMetrics(applicationState)
      };
    }

    // Partial success - needs review
    const failedChecks = Object.entries(checks)
      .filter(([_, check]) => !check.passed)
      .map(([name, check]) => `${name} (${(check.value * 100).toFixed(0)}% < ${(check.threshold * 100).toFixed(0)}%)`);

    return {
      shouldSubmit: false,
      reason: `Quality checks failed: ${failedChecks.join(', ')}`,
      requiresConfirmation: true,
      confidence: avgConfidence,
      weightedScore,
      checks,
      metrics: this.buildMetrics(applicationState)
    };
  }

  /**
   * Pre-checks before detailed analysis
   */
  runPreChecks({ resumeAttached, filledCount, totalRequiredFields, userPreferences }) {
    // Check if user has enabled auto-submit
    if (userPreferences.autoSubmitEnabled === false) {
      return {
        passed: false,
        reason: 'Auto-submit is disabled in user preferences'
      };
    }

    // Resume is mandatory
    if (!resumeAttached) {
      return {
        passed: false,
        reason: 'Resume not attached - manual review required'
      };
    }

    // Minimum fields filled
    if (filledCount < this.minFieldsThreshold) {
      return {
        passed: false,
        reason: `Only ${filledCount} fields filled - need at least ${this.minFieldsThreshold}`
      };
    }

    // Must have required fields to evaluate
    if (totalRequiredFields === 0) {
      return {
        passed: false,
        reason: 'No required fields detected - cannot assess completeness'
      };
    }

    return { passed: true };
  }

  /**
   * Check if critical fields are present
   */
  checkCriticalFields(skippedFields) {
    const criticalFieldPatterns = [
      /email/i,
      /phone/i,
      /\bname\b/i,
      /first.*name/i,
      /last.*name/i,
    ];

    const skippedCritical = skippedFields.filter(sf => {
      const fieldName = sf.field || '';
      return criticalFieldPatterns.some(pattern => pattern.test(fieldName));
    });

    return {
      allPresent: skippedCritical.length === 0,
      presentCount: criticalFieldPatterns.length - skippedCritical.length,
      requiredCount: criticalFieldPatterns.length,
      skippedCritical
    };
  }

  /**
   * Check if platform is trusted
   */
  isPlatformTrusted(platform) {
    const trustedPlatforms = [
      'greenhouse',
      'lever',
      'workday',
      'linkedin',
      'indeed',
      'ashby',
      'smartrecruiters',
      'icims',
      'jobvite',
      'taleo'
    ];

    return trustedPlatforms.includes(platform?.toLowerCase());
  }

  /**
   * Build metrics for reporting
   */
  buildMetrics(applicationState) {
    const {
      filledCount = 0,
      totalRequiredFields = 0,
      skippedFields = [],
      fieldConfidences = [],
      resumeAttached = false
    } = applicationState;

    const fillRate = totalRequiredFields > 0 
      ? (filledCount / totalRequiredFields) * 100 
      : 0;

    const avgConfidence = fieldConfidences.length > 0
      ? (fieldConfidences.reduce((sum, c) => sum + c, 0) / fieldConfidences.length) * 100
      : 0;

    return {
      fillRate: `${fillRate.toFixed(1)}%`,
      avgConfidence: `${avgConfidence.toFixed(1)}%`,
      filledFields: filledCount,
      totalFields: totalRequiredFields,
      skippedFields: skippedFields.length,
      resumeAttached: resumeAttached ? 'Yes' : 'No',
      readyToSubmit: fillRate >= 95 && avgConfidence >= 85
    };
  }

  /**
   * Get recommendation for user
   */
  getRecommendation(decision) {
    if (decision.shouldSubmit) {
      return {
        action: 'auto-submit',
        message: '✅ Application quality is excellent. Safe to auto-submit.',
        color: 'green'
      };
    }

    const { confidence, checks } = decision;

    if (confidence >= 0.75 && checks.fillRate.passed) {
      return {
        action: 'review-recommended',
        message: '⚠️ Application is good but review recommended before submitting.',
        color: 'yellow'
      };
    }

    return {
      action: 'manual-required',
      message: '❌ Application needs manual completion before submission.',
      color: 'red'
    };
  }
}

// Singleton instance
export const autoSubmitEngine = new AutoSubmitEngine();
