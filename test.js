(async () => {
    const userAccounts = await userData.all();

    for (const user of userAccounts) {

        const userAccount = await userData.get(user.discordID);

        console.log(typeof userAccount);
    }
})();