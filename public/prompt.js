let unmerged_object = merged_object = nodePrompt = null;
function handleFocus(event) {
    addGeneratePrompt(nodePrompt);
}

function handleInput(event) {
    const divElement = event.target;
    const spanElement = divElement.querySelector('.submit-prompt');

    // Check if the div is empty other than the span
    if (divElement.childNodes.length === 1 && divElement.childNodes[0] === spanElement) {
        // Remove the span element from the div
        spanElement && divElement.removeChild(spanElement);
    } else {
        addGeneratePrompt(divElement);
    }
}

function handlePaste(event) {
    const divElement = event.target;
    const spanElement = divElement.querySelector('.submit-prompt');
    spanElement && divElement.removeChild(spanElement);
}

function addGeneratePrompt(div) {
    // remove all divs with class submit-prompt
    document.querySelectorAll('.submit-prompt').forEach(submitPrompt => {
        submitPrompt.remove();
    });
    let submitPrompt = document.createElement('span');
    submitPrompt.classList.add('submit-prompt');
    submitPrompt.innerText = 'Synthesise';
    submitPrompt.contentEditable = false;
    submitPrompt.addEventListener('click', function() {
        getObject();
    });
    div.append(submitPrompt);
}

function registerPromptListeners() {
    nodePrompt = document.getElementById('text-container');
    nodePrompt.addEventListener('focus', handleFocus);
    nodePrompt.addEventListener('input', handleInput);
    nodePrompt.addEventListener('paste', handlePaste);
}

function getBasePrompt() {
    return '' +
        'Text: Neo4j is a graph database management system designed for storing and processing connected data. In Neo4j, the data objects are organized in the form of a graph, which consists of nodes and relationships (also known as edges). Here\'s a breakdown of the structure of a Neo4j data object: Nodes: Nodes are the fundamental entities in a Neo4j graph database. They represent objects such as people, places, or things. Each node can have one or more labels to define its type, like "Person" or "City." In addition to labels, nodes can also have properties, which are key-value pairs that store additional information about the node.Relationships: Relationships are the connections between nodes in the graph. They represent how entities are related to each other. Relationships have a type, which describes the nature of the connection, such as \"FRIENDS_WITH\" or \"LIVES_IN.\" Like nodes, relationships can also have properties to store more information about the connection.Properties: Both nodes and relationships can have properties, which are key-value pairs that store additional information about the respective data object. Property keys are strings, and values can be of different data types, such as strings, numbers, or booleans.Labels: Labels are used to categorize nodes in the graph. They help to define the role or type of a node, making it easier to query and retrieve data from the database. Nodes can have multiple labels, allowing for flexible categorization.Indexes: Neo4j supports indexing to improve query performance. Indexes can be created on node properties to speed up searches based on those properties. Indexes are particularly useful when querying for nodes with specific property values or when filtering nodes by their properties.In summary, the structure of a Neo4j data object consists of nodes and relationships, which are connected to form a graph. Nodes have labels and properties, and relationships have types and properties. Indexes can be created to improve query performance on specific node properties. Minified Graph: {nodes:[{id:1,labels:["Concept"],properties:{name:"Node",description:"Nodes are fundamental entities in Neo4j."}},{id:2,labels:["Concept"],properties:{name:"Relationship",description:"Relationships connect nodes in the graph."}},{id:3,labels:["Concept"],properties:{name:"Property",description:"Nodes and relationships have properties."}},{id:4,labels:["Concept"],properties:{name:"Label",description:"Labels categorize nodes in the graph."}},{id:5,labels:["Concept"],properties:{name:"Index",description:"Indexes improve query performance."}}],relationships:[{id:1,startNodeId:1,endNodeId:2,type:"RELATED_TO",properties:{}},{id:2,startNodeId:1,endNodeId:3,type:"HAS_PROPERTY",properties:{}},{id:3,startNodeId:2,endNodeId:3,type:"HAS_PROPERTY",properties:{}},{id:4,startNodeId:1,endNodeId:4,type:"HAS_LABEL",properties:{}},{id:5,startNodeId:1,endNodeId:5,type:"SUPPORTED_BY",properties:{}}]}';
}

function parseJsonString(jsonString) {
    console.log(jsonString)

    // escape all double quotes
    // jsonString = jsonString.replace(/"/g, '\\"');

    // Replace all dsingle quotes with double quotes
    // jsonString = jsonString.replace(/'/g, '"');
  
    // replace neo4j json keys
    jsonString = jsonString.replace(/{nodes:/g, '{"nodes":')
                           .replace(/{id:/g, '{"id":')
                           .replace(/{name:/g, '{"name":')
                           .replace(/,description:/g, ',"description":')
                           .replace(/,startNodeId:/g, ',"startNodeId":')
                           .replace(/,endNodeId:/g, ',"endNodeId":')
                           .replace(/,type:/g, ',"type":')
                           .replace(/,properties:/g, ',"properties":')
                           .replace(/,labels:/g, ',"labels":')
                           .replace(/,relationships:/g, ',"relationships":');

    // Parse the JSON string and return the resulting object
    console.log(jsonString)
    return JSON.parse(jsonString);
}

function getObject(recursive = 1)
{
        let prompt = getBasePrompt() + 'Text: ' +
                    document.getElementById('text-container').innerText +
                    "Minified Graph: {";

        fetch("https://api.openai.com/v1/engines/text-davinci-003/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                prompt: prompt,
                n:1,
                temperature:0,
                max_tokens: 2000,
                stop: ']}'
            })
        })
        .then(response => response.json())
        .then(data => {
            if(data.error) {
                console.log(data.error);
                return;
            }
            // check if first char is { and last char is }
            try {
                console.log(data)
                // add {} around the response text
                data.choices[0].text = '{' + data.choices[0].text + ']}';
                unmerged_object = parseJsonString(data.choices[0].text);
                console.log(unmerged_object)   
                neo4jJson = unmerged_object; 
                renderGraph(neo4jJson);         
            } catch (error) {
                console.log(error)
                if(recursive > 0) {
                    console.log('Error parsing completions data');
                    return;
                }
                getObject(recursive + 1);
            }
        })
        .catch(error => {
            console.log(error)
        });
}

function mergeObjects()
{

}