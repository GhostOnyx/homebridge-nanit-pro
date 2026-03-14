#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const readline = __importStar(require("readline"));
const API_BASE = 'https://api.nanit.com';
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
function ask(question, hidden = false) {
    return new Promise((resolve) => {
        if (hidden) {
            process.stdout.write(question);
            const stdin = process.stdin;
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding('utf8');
            let password = '';
            const onData = (char) => {
                char = char.toString();
                if (char === '\n' || char === '\r' || char === '\u0004') {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    resolve(password);
                }
                else if (char === '\u0003') {
                    process.exit(1);
                }
                else if (char === '\u007f' || char === '\b') {
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                }
                else {
                    password += char;
                    process.stdout.write('*');
                }
            };
            stdin.on('data', onData);
        }
        else {
            rl.question(question, (answer) => resolve(answer.trim()));
        }
    });
}
async function main() {
    console.log('\n🍼 Nanit Homebridge Auth Helper\n');
    console.log('This will log in to your Nanit account and generate a refresh token');
    console.log('for your Homebridge config.\n');
    const email = await ask('Nanit email: ');
    const password = await ask('Nanit password: ', true);
    console.log('\nLogging in...');
    const abortController1 = new AbortController();
    const timeoutId1 = setTimeout(() => abortController1.abort(), 15000);
    const loginResponse = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'nanit-api-version': '1',
        },
        body: JSON.stringify({ email, password }),
        signal: abortController1.signal,
    }).finally(() => clearTimeout(timeoutId1));
    if (loginResponse.ok) {
        const data = await loginResponse.json();
        printResult(data.refresh_token);
        rl.close();
        return;
    }
    if (loginResponse.status === 482) {
        const mfaData = await loginResponse.json();
        const suffix = mfaData.phone_suffix || '??';
        console.log(`\n📱 MFA code sent to your phone ending in ${suffix}`);
        const mfaCode = await ask('Enter MFA code: ');
        console.log('Verifying...');
        const abortController2 = new AbortController();
        const timeoutId2 = setTimeout(() => abortController2.abort(), 15000);
        const mfaResponse = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'nanit-api-version': '1',
                'user-agent': 'Nanit/2.0.6 (com.nanit.app; build:2; iOS 16.0.0) Alamofire/5.4.4',
            },
            body: JSON.stringify({
                email,
                password,
                mfa_token: mfaData.mfa_token,
                mfa_code: mfaCode,
            }),
            signal: abortController2.signal,
        }).finally(() => clearTimeout(timeoutId2));
        if (mfaResponse.ok) {
            const data = await mfaResponse.json();
            printResult(data.refresh_token);
        }
        else if (mfaResponse.status === 429) {
            console.error('\n❌ Rate limited by Nanit. Wait 5 minutes before trying again.');
            console.error('Tip: do not run nanit-auth multiple times in quick succession.');
        }
        else {
            const error = await mfaResponse.text();
            console.error(`\n❌ MFA verification failed (${mfaResponse.status}): ${error}`);
        }
    }
    else if (loginResponse.status === 429) {
        console.error('\n❌ Rate limited by Nanit. Wait 5 minutes before trying again.');
        console.error('Tip: do not run nanit-auth multiple times in quick succession.');
    }
    else {
        const error = await loginResponse.text();
        console.error(`\n❌ Login failed (${loginResponse.status}): ${error}`);
    }
    rl.close();
}
function printResult(refreshToken) {
    console.log('\n✅ Authentication successful!\n');
    console.log('Add this to your Homebridge Nanit config:\n');
    console.log(`    "refreshToken": "${refreshToken}"\n`);
    console.log('Your full platform config should look like:\n');
    console.log('    {');
    console.log('        "platform": "NanitCamera",');
    console.log('        "email": "your@email.com",');
    console.log(`        "refreshToken": "${refreshToken}"`);
    console.log('    }\n');
    console.log('The plugin uses this token to authenticate — it will refresh automatically.');
}
main().catch((error) => {
    console.error('Error:', error.message);
    rl.close();
    process.exit(1);
});
