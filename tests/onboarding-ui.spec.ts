import { test, expect } from './authenticated-browser';
import { createDocument } from '../src/shared/catalog';

const scope = { objective: 'A neighborhood book exchange website', audience: 'Neighbors who enjoy sharing books', direction: 'Warm, readable and welcoming', deliverables: ['Landing page', 'How it works'], constraints: [], acceptanceCriteria: ['Visitors can find where to exchange books'] };

test('questions, saved answers and scope stay in chat with revision conflict recovery', async ({page,baseURL},info) => {
  const headers={Origin:baseURL!};
  await page.goto('/');
  await page.getByLabel('Describe your design').fill('A welcoming website for a neighborhood book exchange');
  await page.getByRole('button',{name:"Let's create"}).click();
  await expect(page.getByRole('region',{name:'Design conversation'})).toBeVisible();
  const id=new URL(page.url()).searchParams.get('project')!;
  const path='/api/projects/'+id+'/brief';
  try {
    let brief=(await (await page.request.get(path)).json()).brief;
    expect(brief.status).toBe('interview');
    await expect(page.getByRole('button',{name:'Start conversation',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Connections',exact:true})).toBeVisible();
    const questions=[
      {id:'constructor',title:'Who is the book exchange for?',type:'single',options:['Neighbors','Schools'],required:true},
      {id:'sections',title:'Which sections should it include?',type:'multiple',options:['How it works','Upcoming events','Our story'],required:true},
      {id:'tone',title:'How should it feel?',type:'text',options:[],required:false},
    ];
    expect((await page.request.put(path,{headers,data:{expectedRevision:brief.revision,interview:{message:'Let’s focus the audience and content.',questions,scope:null}}})).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading',{name:questions[0].title})).toBeVisible();
    await expect(page.getByRole('heading',{name:questions[1].title})).toHaveCount(0);
    await page.getByRole('button',{name:'Neighbors',exact:true}).click();
    let release!:()=>void,arrive!:()=>void;
    const held=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{arrive=r});
    await page.route('**'+path,async route=>{if(route.request().method()!=='PUT')return route.continue();const response=await route.fetch();arrive();await held;await route.fulfill({response});});
    await page.getByRole('button',{name:'Send answer',exact:true}).click();await arrived;
    try {await expect(page.getByLabel('Answer: '+questions[0].title)).toBeDisabled();}finally{release();}
    await expect(page.getByRole('heading',{name:questions[1].title})).toBeVisible();await page.unroute('**'+path);
    await page.getByRole('button',{name:'How it works',exact:true}).click();await page.getByRole('button',{name:'Upcoming events',exact:true}).click();
    await page.getByRole('button',{name:'Send answer',exact:true}).click();
    await expect(page.getByRole('heading',{name:questions[2].title})).toBeVisible();
    await page.reload();await expect(page.getByRole('heading',{name:questions[2].title})).toBeVisible();
    await expect(page.locator('.conversation-answer')).toContainText(['Neighbors','How it works, Upcoming events']);
    await page.getByLabel('Answer: '+questions[2].title).fill('Warm and welcoming');
    await page.getByRole('button',{name:'Send answer',exact:true}).click();
    await page.getByRole('button',{name:'Write the brief myself',exact:true}).click();
    await page.getByLabel('Audience',{exact:true}).fill(scope.audience);
    await page.getByLabel('Visual direction',{exact:true}).fill(scope.direction);
    await page.getByLabel('Deliverables',{exact:true}).fill(scope.deliverables[0]);
    await page.getByLabel('Deliverables',{exact:true}).press('End');
    await page.getByLabel('Deliverables',{exact:true}).press('Enter');
    await page.getByLabel('Deliverables',{exact:true}).pressSequentially(scope.deliverables[1]);
    await expect(page.getByLabel('Deliverables',{exact:true})).toHaveValue(scope.deliverables.join('\n'));
    await page.getByLabel('Acceptance criteria',{exact:true}).fill(scope.acceptanceCriteria.join('\n'));
    await page.getByRole('button',{name:'Save brief',exact:true}).click();
    await expect(page.getByRole('button',{name:'Approve and create',exact:true})).toBeDisabled();
    brief=(await (await page.request.get(path)).json()).brief;
    expect(brief.status).toBe('ready');expect(brief.answers.constructor).toBe('Neighbors');expect(brief.answers.sections).toEqual(['How it works','Upcoming events']);
    await page.getByRole('region',{name:'Design scope'}).getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByLabel('Audience',{exact:true}).fill('Families in the neighborhood');
    expect((await page.request.put(path,{headers,data:{expectedRevision:brief.revision,request:brief.request+' with family activities'}})).status()).toBe(200);
    await page.getByRole('button',{name:'Save brief',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('The brief changed');
    await expect(page.getByLabel('Audience',{exact:true})).toHaveValue('Families in the neighborhood');
    await page.getByRole('button',{name:'Reload current brief',exact:true}).click();
    await expect(page.getByLabel('Audience',{exact:true})).toHaveValue(scope.audience);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Edit',exact:true}).first().click();
    await expect(page.locator('.editor-shell')).not.toHaveClass(/conversation-mode/);
    await page.getByRole('button',{name:'Continue design interview'}).click();
    await expect(page.locator('.editor-shell')).toHaveClass(/conversation-mode/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('conversational-brief.png'),fullPage:true});
    const history=(await (await page.request.get(path+'/history')).json()).history;
    expect(history.length).toBeGreaterThan(4);
  } finally {await page.request.delete('/api/projects/'+id,{headers});}
});

test('approve and create previews a draft, preserves approval on failure, and applies only on review',async({page,baseURL},info)=>{
  const headers={Origin:baseURL!};
  const connection=await page.request.put('/api/providers/custom-onboarding-text',{headers,data:{name:'Onboarding text',baseUrl:'https://browser-provider.example/v1',model:'onboarding-model',protocol:'openai',authMethod:'none'}});expect(connection.status()).toBe(200);
  const created=await page.request.post('/api/projects',{headers,data:{name:'Reviewed first design',kind:'web'}});expect(created.status()).toBe(201);
  const {project}=await created.json();const path='/api/projects/'+project.id+'/brief';
  let generationCalls=0;
  try{
    expect((await page.request.put(path,{headers,data:{expectedRevision:0,request:'A book exchange',interview:{message:'Review the direction.',questions:[],scope}}})).status()).toBe(200);
    // Fixture provider transport checks UI review behavior; real revisions and saves use the server.
    await page.route('**/api/projects/'+project.id+'/generate',async route=>{
      generationCalls++;
      if(generationCalls===1)return route.fulfill({status:502,json:{error:{code:'provider_failed',message:'Provider temporarily unavailable'}}});
      const current=(await (await page.request.get('/api/projects/'+project.id)).json()).project;
      const currentBrief=(await (await page.request.get(path)).json()).brief;
      const document=createDocument('web','Reviewed first design',undefined,'studio-landing');document.id=project.id;document.pages[0].nodes[0].name='New draft content';
      return route.fulfill({json:{document,baseRevision:current.revision,baseBriefRevision:currentBrief.revision}});
    });
    await page.goto('/?project='+project.id);
    await expect(page.getByLabel('Design assistant')).toHaveValue('api:custom-onboarding-text');
    await page.getByRole('button',{name:'Approve and create',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Provider temporarily unavailable');
    const approved=(await (await page.request.get(path)).json()).brief;expect(approved.status).toBe('approved');
    await expect(page.getByRole('button',{name:'Create design',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Create design',exact:true}).click();
    await expect(page.getByRole('button',{name:'View design',exact:true})).toBeVisible();
    expect((await (await page.request.get('/api/projects/'+project.id)).json()).project.revision).toBe(project.revision);
    expect((await (await page.request.get(path)).json()).brief.revision).toBe(approved.revision);
    await page.getByRole('button',{name:'View design',exact:true}).click();
    await expect(page.getByText('Previewing an AI proposal',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Export',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeDisabled();
    await page.screenshot({path:info.outputPath('first-draft-preview.png'),fullPage:true});
    await page.getByRole('button',{name:'Apply proposal',exact:true}).click();
    await expect(page.getByText('Previewing an AI proposal',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Export',exact:true})).toBeEnabled();
    expect((await (await page.request.get('/api/projects/'+project.id)).json()).project.revision).toBe(project.revision+1);
    await page.reload();expect(generationCalls).toBe(2);
  }finally{await page.request.delete('/api/projects/'+project.id,{headers});await page.request.delete('/api/providers/custom-onboarding-text',{headers});}
});

test('chat draft survives detailed editing and browser navigation',async({page,baseURL})=>{
  const headers={Origin:baseURL!};const {project}=await (await page.request.post('/api/projects',{headers,data:{name:'Switch workspaces',kind:'web'}})).json();
  try{
    await page.goto('/?project='+project.id);
    await page.getByLabel('Message to AI designer').fill('Keep this unsent idea');
    await page.locator('.assistant-options > summary').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.assistant-options')).not.toHaveAttribute('open');
    await expect(page.locator('.editor-shell')).toHaveClass(/conversation-mode/);
    await expect(page.locator('.inspector')).toBeHidden();
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(page.getByRole('button',{name:'Add text',exact:true})).toBeVisible();
    await page.locator('.editor-header').getByRole('button',{name:'Chat',exact:true}).click();
    // The composer stays mounted in Edit; its value alone cannot confirm navigation finished.
    await expect(page.locator('.editor-shell')).toHaveClass(/conversation-mode/);
    await expect(page.getByLabel('Message to AI designer')).toBeVisible();
    await expect(page.getByLabel('Message to AI designer')).toHaveValue('Keep this unsent idea');
    await page.goBack();await expect(page).toHaveURL(/mode=edit/);await expect(page.locator('.editor-shell')).not.toHaveClass(/conversation-mode/);
    await page.goForward();await expect(page).toHaveURL(/mode=chat/);await expect(page.locator('.editor-shell')).toHaveClass(/conversation-mode/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{await page.request.delete('/api/projects/'+project.id,{headers});}
});
