module.exports = {
    updateAllBettingLines: async function() {
        const response = await fetch(`${process.env.URL}/betting/new/${process.env.YEAR}`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${process.env.YEAR}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("✅ Betting lines successfully updated");
            } else {
                console.log("❌ Betting lines could not be refreshed" + " | " + response.status);
            }
        });
    }
};