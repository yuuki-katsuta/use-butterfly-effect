export const sleep = async () => {
	const sleep = () => new Promise((resolve) => setTimeout(resolve, 1000));
	await sleep();
};
