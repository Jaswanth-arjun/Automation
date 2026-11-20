/**
 * AutoApplyEngine — Server-side Puppeteer job application automation
 * Powered by GPT-6 Luna Vision-Driven Agent.
 */

import { EventEmitter } from 'events';
import { Gpt6VisionEngine } from './gpt6-vision-engine.js';
import { findVaultCredential, saveVaultCredential, saveVaultAnswer } from './vault-manager.js';

export class AutoApplyEngine extends EventEmitter {
  constructor() {
    super();
    this.visionEngine = new Gpt6VisionEngine();
    this.pendingInputs = new Map();

    // Forward vision engine progress and completion events
    this.visionEngine.on('progress', (event) => {
      this.emit('progress', event);
    });

    this.visionEngine.on('complete', (result) => {
      this.emit('complete', result);
    });
  }

  get isRunning() {
    return this.visionEngine.isRunning;
  }

  _progress(step, message, details = {}) {
    const event = { step, message, timestamp: Date.now(), ...details };
    this.emit('progress', event);
    return event;
  }

  provideUserInput(inputId, value, saveToVault = true, domain = '', fieldKey = '') {
    const pending = this.pendingInputs.get(inputId);
    if (pending) {
      if (saveToVault && domain) {
        if (fieldKey === 'password' || fieldKey.includes('password')) {
          saveVaultCredential(domain, { password: value });
        } else {
          saveVaultAnswer(fieldKey || domain, value);
        }
      }
      pending.resolve(value);
      this.pendingInputs.delete(inputId);
      return true;
    }
    return false;
  }

  async apply(config) {
    return await this.visionEngine.apply(config);
  }

  async close() {
    return await this.visionEngine.close();
  }
}
