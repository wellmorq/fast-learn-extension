const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'scripts', 'utils.js'), 'utf8'));

function assert(cond, msg) {
    if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
    else console.log('ok:', msg);
}

const source = ['glm-5.2'];
const preserved = includeSelectedModel(source, 'legacy-model');
assert(preserved[0] === 'legacy-model', 'missing selected model is preserved');
assert(source.length === 1, 'model source list is not mutated');

const gemini = includeSelectedModel(['models/gemini-3.5-pro'], 'gemini-3.5-pro');
assert(gemini.length === 1, 'models/ prefix does not create duplicates');
assert(modelNamesEqual('models/gemini-3-flash', 'gemini-3-flash'), 'prefixed and bare model names compare equally');
assert(modelNamesEqual('glm-5.2', 'glm-5.2'), 'identical model names compare equally');
assert(!modelNamesEqual('gemini-3-flash', 'gemini-3-pro'), 'different model names do not compare equally');
assert(!modelNamesEqual('', 'gemini-3-flash'), 'missing model names do not compare equally');

console.log(process.exitCode ? 'TESTS FAILED' : 'ALL TESTS PASSED');
