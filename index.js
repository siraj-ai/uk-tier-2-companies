const { Builder } = require('selenium-webdriver');
const { Options } = require('selenium-webdriver/chrome');
const delay = require('delay');

const { readDataFromS3, writeDataToS3, createS3Bucket } = require('./helpers');

const { bundleId } = require('./package.json');
const { BUCKET_NAME, INIT, SIZE } = process.env;
const proxyAddress = 'luminati:24000';

const options = new Options()
    .headless()
    .windowSize({
        width: 1024,
        height: 768
    });

async function main() {

    let driver = null;

    while (true) {
        try {
            driver = await new Builder()
                .forBrowser('chrome')
                .usingServer('http://selenium:4444/wd/hub')
                .setChromeOptions(options)
                .build();
            break;
        } catch (e) {
            console.log('ERROR', e);
            await delay(5000);
        }
    }

        console.log('DRIVER STARTED');

        const companies = await readDataFromS3(bundleId, 'companies.json');

        console.log('COMPANIES', companies.length);

        for (let i=900; i<companies.length; i++) {
            await driver.get(`https://www.indeed.co.uk/companies/search?from=discovery-cmp-front-door&q=${companies[i].organisationName.replace(/ /g,'+')}`);

            const indeedUrl = await driver.executeScript(`
               const link = document.querySelector('.cmp-company-tile-blue-name > a');
               return link ? link.href : link;
            `);
            if(!indeedUrl) continue;

            companies[i].indeedUrl = indeedUrl;

            await driver.get(indeedUrl + '/jobs');
            const noOpenings = await driver.executeScript(`
                return document.body.innerText.includes('There are currently no open jobs')
            `);
            const jobs = await driver.executeScript(`
                const jobListSection = document.querySelector('.cmp-JobList-jobList');
                let jobs = []
                if(jobListSection) {
                    const jobList = [...jobListSection.querySelectorAll('li')];
                    jobs = jobList.map(job => {
                        const id = job.dataset.tnEntityid.split(',')[1]
                        const title = job.querySelector('.cmp-JobListItem-title').textContent
                        const city =  job.querySelector('.cmp-JobListItem-subtitle').textContent
                        const time = job.querySelector('.cmp-JobListItem-timeTag').textContent
                        return { id, title, city, time };
                    })
                }
                return jobs
            `);
            companies[i] = { ...companies[i], noOpenings, jobs };

            if(i % 50 === 0) {
                console.log('PROGRESS', i);
                await writeDataToS3(bundleId,'companies.json', companies);
            }
        }
         await writeDataToS3(bundleId,'companies.json', companies);
}

main();
