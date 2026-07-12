

const NUM_LINES = 1000;

async function run() {
  for (let i = 0; i < NUM_LINES; i++) {
    // Interleave stdout and stderr
    if (i % 2 === 0) {
      process.stdout.write(`stdout line ${i}\n`);
    } else {
      process.stderr.write(`stderr line ${i}\n`);
    }

    // Small delay occasionally to encourage buffering boundaries
    if (i % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
