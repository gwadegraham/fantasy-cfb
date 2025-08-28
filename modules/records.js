module.exports = {
    updateAllTeamRecords: async function() {
        const response = await fetch(`${process.env.URL}/records/new/${process.env.YEAR}`, {
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
                console.log("✅ New team records retrieved");
            } else {
                console.log("❌ Team Records could not be retrieved" + " | " + response.status);
            }
        });
    }
};