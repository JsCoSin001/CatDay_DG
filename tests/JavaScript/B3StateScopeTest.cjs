'use strict';
global.window = global;
require('../../public/js/cat-day/b3-state.js');
const s = global.B3State;
function assert(cond, msg){ if(!cond){ throw new Error(msg); } }
assert(typeof s.hasPlanScope === 'function', 'B3State.hasPlanScope must exist');
s.showAll = false; s.selectedPlan = null;
assert(s.hasPlanScope() === false, 'no selected plan and search-all off must not allow scanning');
s.selectedPlan = {id: 1};
assert(s.hasPlanScope() === true, 'selected plan must allow scanning');
s.selectedPlan = null; s.showAll = true;
assert(s.hasPlanScope() === true, 'search-all must allow scanning');
console.log('B3_STATE_SCOPE_PASS');
